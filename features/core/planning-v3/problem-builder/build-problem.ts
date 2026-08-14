import type { EmployeeId, IsoDate, PlanningId, WeekDay } from "@/features/core/models"
import { holidayBlocksEmployee, WEEK_DAYS } from "@/features/core/models"
import { enumerateDates, intervalMinutes, isoWeekKey, weekDayOf } from "@/features/core/shared"

import type { PlanningGenerationInput } from "@/features/core/planning-generator/types/generation-input"
import type { SectorPresenceFloor } from "@/features/core/planning-generator/types/business-pipeline"

import { computeDailyBudgets } from "@/features/core/planning-v3/problem-builder/daily-budget"
import {
  PLANNING_OBJECTIVES_V3,
  PLANNING_MULTI_SECTOR_OBJECTIVES_V3,
  PLANNING_PROBLEM_V3_VERSION,
  type PlanningDayV3,
  type PlanningDemandSlotV3,
  type PlanningDailyCapSourceV3,
  type PlanningEmployeeDayV3,
  type PlanningEmployeeV3,
  type PlanningProblemV3,
  type PlanningRulesV3,
} from "@/features/core/planning-v3/types/problem"
import type { PlanningInfeasibilityV3 } from "@/features/core/planning-v3/types/validation"

/**
 * PlanningProblemBuilderV3 — the pure translation from the application's
 * `PlanningGenerationInput` into an immutable `PlanningProblemV3`.
 *
 * Three properties are load-bearing:
 *
 * 1. It never falls back. A historical record that predates a Sprint 3D field
 *    produces a structured error, not a guessed default and not a silent
 *    hand-off to the V2 pipeline. The whole reason V3 exists is that such a
 *    fallback once reactivated the old engine without anyone noticing.
 * 2. It normalises everything to integer minutes. "HH:mm" and decimal hours do
 *    not cross this boundary.
 * 3. It is deterministic. No clock, no randomness, no iteration over unordered
 *    collections — employees, days and slots all come out in a stable order.
 *
 * It reuses the Core models and the Core date/time primitives, and nothing
 * else. In particular it borrows no placement or repair function from V2.
 */

export type PlanningProblemBuildResultV3 =
  | { readonly ok: true; readonly problem: PlanningProblemV3 }
  | { readonly ok: false; readonly errors: readonly PlanningInfeasibilityV3[] }

export function buildPlanningProblemV3(
  input: PlanningGenerationInput
): PlanningProblemBuildResultV3 {
  const errors: PlanningInfeasibilityV3[] = []
  const fail = (error: PlanningInfeasibilityV3) => errors.push(error)

  // ── Sector ────────────────────────────────────────────────────────────────
  const sectors = input.business?.sectors
  if (sectors === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: "sectors_missing",
          path: "business.sectors",
          message:
            "Aucun secteur fourni. Planning V3 exige des secteurs explicites et ne retombe pas sur le pipeline V2.",
        },
      ],
    }
  }
  const active = sectors.filter((sector) => sector.active)
  if (active.length === 0) {
    return {
      ok: false,
      errors: [
        { code: "no_active_sector", path: "business.sectors", message: "Aucun secteur actif." },
      ],
    }
  }
  if (active.length > 1) {
    return buildMultiSectorProblemV3(input, active)
  }
  const sector = active[0]

  // The historical field whose absence once silently reactivated the old
  // engine. V3 refuses to guess it.
  if (typeof sector.workEveryNonFixedRestDay !== "boolean") {
    fail({
      code: "historical_field_missing",
      path: `business.sectors.${sector.id}.workEveryNonFixedRestDay`,
      message: `Le secteur « ${sector.name} » ne définit pas workEveryNonFixedRestDay. Ce champ historique doit être migré explicitement avant toute génération V3.`,
    })
  }

  // ── Time step ─────────────────────────────────────────────────────────────
  const timeStepMinutes =
    input.settings.timeIncrementMinutes ?? input.store.planningSettings.granularity
  if (typeof timeStepMinutes !== "number" || !Number.isInteger(timeStepMinutes) || timeStepMinutes <= 0) {
    fail({
      code: "time_step_missing",
      path: "settings.timeIncrementMinutes",
      message: "Le pas de temps est obligatoire et doit être un entier positif de minutes.",
    })
  }
  const step = typeof timeStepMinutes === "number" ? timeStepMinutes : 15

  // ── Horizon ───────────────────────────────────────────────────────────────
  const { start, end } = input.settings.period
  const dates = enumerateDates(start, end)
  if (dates.length === 0) {
    fail({
      code: "empty_period",
      path: "settings.period",
      message: `La période ${start} → ${end} ne contient aucune date.`,
    })
  }
  const weekKeys = new Set(dates.map(isoWeekKey))
  if (weekKeys.size > 1) {
    fail({
      code: "multi_week_period",
      path: "settings.period",
      message: `Planning V3A traite une seule semaine ISO, ${weekKeys.size} reçues (${[...weekKeys].sort().join(", ")}).`,
    })
  }

  // ── Employees ─────────────────────────────────────────────────────────────
  const assigned = new Set(sector.assignedEmployeeIds.map(String))
  const roster = [...input.employees]
    .filter((employee) => employee.status === "active" && assigned.has(String(employee.id)))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
  if (roster.length === 0) {
    fail({
      code: "no_assigned_employee",
      path: `business.sectors.${sector.id}.assignedEmployeeIds`,
      message: `Aucun salarié actif affecté au secteur « ${sector.name} ».`,
    })
  }

  interface EmployeeConstraintBucket {
    fixedRestDays: WeekDay[]
    maxOpenings: number | null
    maxClosings: number | null
    /** Minutes since midnight. Null means the employee declared no bound. */
    earliestStart: number | null
    latestEnd: number | null
    /** Heures IMPOSÉES, pas seulement bornées. */
    exactStart: number | null
    exactEnd: number | null
    /** Jours où ce salarié doit ouvrir, respectivement fermer. */
    mustOpenDays: WeekDay[]
    mustCloseDays: WeekDay[]
  }
  const constraintsByEmployee = new Map<string, EmployeeConstraintBucket>()
  for (const employee of roster) {
    constraintsByEmployee.set(String(employee.id), {
      fixedRestDays: [],
      maxOpenings: null,
      maxClosings: null,
      earliestStart: null,
      latestEnd: null,
      exactStart: null,
      exactEnd: null,
      mustOpenDays: [],
      mustCloseDays: [],
    })
  }
  for (const constraint of input.employeeConstraints ?? []) {
    const bucket = constraintsByEmployee.get(String(constraint.employeeId))
    if (!bucket) continue
    if ((constraint.type === "FIXED_DAY_OFF" || constraint.type === "FORBIDDEN_DAY") && constraint.day) {
      bucket.fixedRestDays.push(constraint.day)
    }
    if (constraint.type === "MAX_OPENINGS" && typeof constraint.value === "number") {
      bucket.maxOpenings = constraint.value
    }
    if (constraint.type === "MAX_CLOSINGS" && typeof constraint.value === "number") {
      bucket.maxClosings = constraint.value
    }
    if (constraint.type === "EARLIEST_START" && typeof constraint.value === "number") {
      bucket.earliestStart = constraint.value
    }
    if (constraint.type === "LATEST_END" && typeof constraint.value === "number") {
      bucket.latestEnd = constraint.value
    }
    // Une heure imposée est AUSSI une borne : elle rétrécit la fenêtre
    // exactement comme la borne souple, et fixe en plus le point de départ.
    if (constraint.type === "EXACT_START" && typeof constraint.value === "number") {
      bucket.exactStart = constraint.value
      bucket.earliestStart = constraint.value
    }
    if (constraint.type === "EXACT_END" && typeof constraint.value === "number") {
      bucket.exactEnd = constraint.value
      bucket.latestEnd = constraint.value
    }
    if (constraint.type === "MUST_OPEN" && constraint.day) {
      bucket.mustOpenDays.push(constraint.day)
    }
    if (constraint.type === "MUST_CLOSE" && constraint.day) {
      bucket.mustCloseDays.push(constraint.day)
    }
  }
  for (const [employeeId, bucket] of constraintsByEmployee) {
    if (bucket.earliestStart === null || bucket.latestEnd === null) continue
    if (bucket.earliestStart < bucket.latestEnd) continue
    fail({
      code: "individual_window_empty",
      employeeId: roster.find((employee) => String(employee.id) === employeeId)?.id,
      path: `employeeConstraints.${employeeId}`,
      message: `Les bornes horaires individuelles de ${employeeId} sont contradictoires : début ${clock(bucket.earliestStart)} au plus tôt, fin ${clock(bucket.latestEnd)} au plus tard.`,
    })
  }

  const preferences = new Map(
    (input.business?.employeePreferences ?? []).map((preference) => [
      String(preference.employeeId),
      preference,
    ])
  )

  const employees: PlanningEmployeeV3[] = []
  for (const employee of roster) {
    const contract = (input.contracts ?? []).find((item) => item.employeeId === employee.id)
    if (!contract) {
      fail({
        code: "contract_missing",
        employeeId: employee.id,
        path: `contracts.${String(employee.id)}`,
        message: `${employee.firstName} ${employee.lastName} n'a aucun contrat.`,
      })
      continue
    }
    // Integer minutes are the source of truth. A decimal-hours-only contract is
    // ambiguous (36.75 h vs 36 h 45) and must be migrated, never rounded here.
    if (typeof contract.weeklyMinutes !== "number" || !Number.isInteger(contract.weeklyMinutes)) {
      fail({
        code: "contract_minutes_missing",
        employeeId: employee.id,
        path: `contracts.${String(employee.id)}.weeklyMinutes`,
        message: `Le contrat de ${employee.firstName} ${employee.lastName} n'expose pas de weeklyMinutes entier. Planning V3 n'accepte aucune conversion implicite depuis weeklyHours.`,
      })
      continue
    }
    if (contract.weeklyMinutes % step !== 0) {
      fail({
        code: "contract_minutes_off_step",
        employeeId: employee.id,
        path: `contracts.${String(employee.id)}.weeklyMinutes`,
        message: `Le contrat de ${employee.firstName} ${employee.lastName} (${contract.weeklyMinutes} min) n'est pas un multiple du pas de ${step} minutes.`,
      })
      continue
    }

    const bucket = constraintsByEmployee.get(String(employee.id))
    const preference = preferences.get(String(employee.id))
    employees.push({
      id: employee.id,
      firstName: employee.firstName,
      lastName: employee.lastName,
      contractMinutes: contract.weeklyMinutes,
      workingDays: WEEK_DAYS.filter((day) => contract.workingDays.includes(day)),
      fixedRestDays: WEEK_DAYS.filter((day) => bucket?.fixedRestDays.includes(day)),
      minimumDailyMinutes: Math.round(contract.minDailyHours * 60),
      maximumDailyMinutes: Math.round(contract.maxDailyHours * 60),
      canOpen: employee.capabilities.includes("CAN_OPEN"),
      canClose: employee.capabilities.includes("CAN_CLOSE"),
      canSplitShift: employee.capabilities.includes("CAN_SPLIT_SHIFT"),
      // An individual cap REPLACES the sector's; an absent one INHERITS it.
      // `?? ` rather than `Math.min` on purpose: the individual value is the
      // decision someone made about this person, and a manager who raises
      // someone's cap above the sector default meant to raise it.
      maximumOpenings: bucket?.maxOpenings ?? sector.maximumOpeningsPerWeek ?? null,
      maximumClosings: bucket?.maxClosings ?? sector.maximumClosingsPerWeek ?? null,
      prefersOpening: false,
      prefersClosing: preference?.prefersClosing ?? false,
    })
  }

  // ── Days and exact daily budgets ──────────────────────────────────────────
  const totalContractMinutes = employees.reduce((sum, employee) => sum + employee.contractMinutes, 0)
  const explicitBudgets = sector.dailyBudgetMinutes
  let budgetByDay: Map<WeekDay, number>
  if (explicitBudgets) {
    const invalidDay = WEEK_DAYS.find((day) => {
      const value = explicitBudgets[day]
      return !Number.isInteger(value) || value < 0 || value % step !== 0
    })
    const explicitTotal = WEEK_DAYS.reduce((sum, day) => sum + (explicitBudgets[day] ?? 0), 0)
    if (invalidDay) {
      fail({
        code: "daily_budget_invalid",
        path: `business.sectors.${sector.id}.dailyBudgetMinutes.${invalidDay}`,
        message: `Le budget automatique du ${invalidDay} doit être un entier positif multiple de ${step} minutes.`,
      })
    }
    if (explicitTotal !== totalContractMinutes) {
      fail({
        code: "daily_budget_total_mismatch",
        path: `business.sectors.${sector.id}.dailyBudgetMinutes`,
        message: `Les budgets automatiques totalisent ${explicitTotal} min, contre ${totalContractMinutes} min attribuées aux salariés du rayon.`,
      })
    }
    budgetByDay = new Map(WEEK_DAYS.map((day) => [day, explicitBudgets[day] ?? 0]))
  } else {
    const budgets = computeDailyBudgets(totalContractMinutes, sector.weeklyDistribution, step)
    if (!budgets.ok) {
      fail({
        code: "daily_budget_undefined",
        path: `business.sectors.${sector.id}.weeklyDistribution`,
        message: budgets.error,
      })
    }
    budgetByDay = new Map(
      budgets.ok ? budgets.budgets.map((budget) => [budget.day, budget.budgetMinutes]) : []
    )
  }

  // Les fériés réglés par le magasin, par date. Vide tant que personne n'a
  // ouvert l'écran des fériés — et alors rien de ce qui suit ne s'active.
  const holidayPlanByDate = new Map(
    (input.holidayPlan ?? []).map((entry) => [entry.date, entry] as const)
  )

  const days: PlanningDayV3[] = []
  for (const date of dates) {
    const weekDay = weekDayOf(date)
    const storeHours = input.store.openingHours.find((item) => item.day === weekDay)
    const sectorHours = sector.hours?.find((item) => item.day === weekDay)
    const storeClosed = !storeHours || storeHours.closed || !storeHours.opensAt || !storeHours.closesAt
    // ── Whose hours decide ─────────────────────────────────────────────────
    //
    // The SECTOR's, whenever it states them. A sector is not a subdivision of
    // the sales floor's timetable: a Drive opens before the shop and an Accueil
    // stays past its closing, and both are ordinary. This used to intersect the
    // two windows, which silently clipped every sector that ran wider than the
    // store and made those hours unplannable — the schedule simply could not
    // place anyone there, with nothing on screen saying why.
    //
    // The store's hours remain the FALLBACK for a sector that declares none.
    const sectorDeclaresHours = sectorHours !== undefined
    const closed = sectorDeclaresHours ? sectorHours.closed : storeClosed

    let opensAtMinutes: number | null = null
    let closesAtMinutes: number | null = null
    if (!closed && (sectorDeclaresHours || (storeHours?.opensAt && storeHours.closesAt))) {
      const openSource = sectorDeclaresHours ? sectorHours.opensAt : storeHours!.opensAt!
      const closeSource = sectorDeclaresHours ? sectorHours.closesAt : storeHours!.closesAt!
      const open = minutesOfDay(openSource)
      const close = minutesOfDay(closeSource)
      if (open === null || close === null) {
        fail({
          code: "malformed_hours",
          date,
          path: sectorDeclaresHours
            ? `business.sectors.${sector.id}.hours.${weekDay}`
            : `store.openingHours.${weekDay}`,
          message: `Les horaires du ${date} ne sont pas au format "HH:mm".`,
        })
      } else {
        opensAtMinutes = open
        closesAtMinutes = close
        if (closesAtMinutes <= opensAtMinutes) {
          fail({
            code: "empty_opening_window",
            date,
            path: `business.sectors.${sector.id}.hours.${weekDay}`,
            message: `Le ${date}, la fenêtre d'ouverture du secteur est vide.`,
          })
        }
      }
    }

    const budgetMinutes = closed ? 0 : (budgetByDay.get(weekDay) ?? 0)
    if (closed && (budgetByDay.get(weekDay) ?? 0) > 0) {
      fail({
        code: "budget_on_closed_day",
        date,
        path: `business.sectors.${sector.id}.weeklyDistribution.${weekDay}`,
        message: `Le ${date} est fermé mais la répartition hebdomadaire lui attribue ${budgetByDay.get(weekDay)} minutes.`,
      })
    }

    // ── Un jour férié réglé remplace la journée ordinaire ──────────────────
    //
    // Le réglage d'un férié est plus précis que l'horaire du jour de la
    // semaine : il a été saisi POUR cette date. Un férié chômé ferme donc la
    // journée — et sans passer par `budget_on_closed_day`, qui traque une
    // contradiction de configuration (un secteur fermé le lundi avec du budget
    // le lundi) et non une fermeture exceptionnelle parfaitement légitime.
    //
    // Sans plan férié, chacune de ces expressions retombe sur la valeur
    // précédente : le problème construit est le même, à l'octet près.
    const holidayEntry = holidayPlanByDate.get(date)
    const holidayClosed = holidayEntry?.opening === "chome"
    const holidayWindow =
      holidayEntry !== undefined
      && !holidayClosed
      && holidayEntry.opensAtMinutes !== null
      && holidayEntry.closesAtMinutes !== null
      && holidayEntry.closesAtMinutes > holidayEntry.opensAtMinutes
        ? holidayEntry
        : null

    days.push({
      date,
      weekDay,
      weekKey: isoWeekKey(date),
      closed: closed || holidayClosed === true,
      opensAtMinutes: holidayClosed ? null : holidayWindow?.opensAtMinutes ?? opensAtMinutes,
      closesAtMinutes: holidayClosed ? null : holidayWindow?.closesAtMinutes ?? closesAtMinutes,
      budgetMinutes: holidayClosed ? 0 : budgetMinutes,
      ...(sector.dailyBudgetMode ? { budgetMode: sector.dailyBudgetMode } : {}),
    })
  }

  // ── Availability, per employee and per date ───────────────────────────────
  //
  // Individual working-hour bounds, keyed by employee id. Undated because the
  // constraints that produce them are: « ne commence pas avant 08:00 » is a fact
  // about the person, not about a Tuesday. The intersection below is what makes
  // them safe — a bound can only ever NARROW the sector's window, never widen
  // it, so an employee free from 06:00 in a sector opening at 08:00 still starts
  // at 08:00.
  const individualWindows: ReadonlyMap<
    string,
    { readonly earliest?: number; readonly latest?: number }
  > = new Map(
    [...constraintsByEmployee]
      .filter(([, bucket]) => bucket.earliestStart !== null || bucket.latestEnd !== null)
      .map(([employeeId, bucket]) => [
        employeeId,
        {
          ...(bucket.earliestStart === null ? {} : { earliest: bucket.earliestStart }),
          ...(bucket.latestEnd === null ? {} : { latest: bucket.latestEnd }),
        },
      ])
  )

  const absences = input.absences ?? []
  const holidays = new Set((input.holidays ?? []).map((holiday) => holiday.date))
  const mandatoryEverywhere = sector.workEveryNonFixedRestDay === true

  const employeeDays: PlanningEmployeeDayV3[] = []
  for (const employee of employees) {
    for (const day of days) {
      const fixedRest = employee.fixedRestDays.includes(day.weekDay)
      const contracted = employee.workingDays.includes(day.weekDay)
      const absent = absences.some(
        (absence) =>
          absence.employeeId === employee.id &&
          day.date >= absence.range.start &&
          day.date <= absence.range.end
      )
      // Un férié réglé décide À LA PLACE de la liste historique : chômé, il
      // ferme la journée pour tout le monde ; ouvert, il ne laisse entrer que
      // les volontaires. Une date absente du plan retombe sur l'ancienne règle,
      // qui bloquait indistinctement — c'est ce qui rend l'ajout invisible pour
      // un magasin qui n'a rien réglé.
      const plannedHoliday = holidayPlanByDate.get(day.date)
      const holiday = plannedHoliday
        ? holidayBlocksEmployee(plannedHoliday, String(employee.id))
        : holidays.has(day.date)
      const available = !day.closed && contracted && !fixedRest && !absent && !holiday

      // The employee's own window for this day: the sector's hours narrowed by
      // whatever individual bound the employee declared. Written as an explicit
      // intersection so a bound can only ever shrink the window. A closed day
      // has no window to narrow and keeps its empty [0, 0].
      const individual =
        day.opensAtMinutes === null || day.closesAtMinutes === null
          ? undefined
          : individualWindows.get(String(employee.id))
      const earliestStartMinutes = Math.max(
        day.opensAtMinutes ?? 0,
        individual?.earliest ?? 0
      )
      const latestEndMinutes = Math.min(
        day.closesAtMinutes ?? 0,
        individual?.latest ?? Number.POSITIVE_INFINITY
      )
      if (available && latestEndMinutes <= earliestStartMinutes) {
        fail({
          code: "individual_window_outside_opening",
          employeeId: employee.id,
          date: day.date,
          path: `employeeConstraints.${String(employee.id)}`,
          message: `Le ${day.date}, les bornes horaires de ${employee.firstName} ${employee.lastName} (${clock(earliestStartMinutes)} → ${clock(latestEndMinutes)}) ne laissent aucune plage travaillable dans les horaires du secteur.`,
        })
      }

      // Not the sector's window: the employee's. Someone barred from starting
      // before 10:00 in a 08:00–20:00 sector can work ten hours, not twelve, and
      // a ceiling read from the sector would let the solver propose a day that
      // no legal start time can produce.
      // Mono-secteur : le plafond seul, sans sa provenance.
      //
      // Le champ ne sert qu'au diagnostic des rôles par rayon, qui n'existe pas
      // ici — et l'ajouter changerait les fixtures partagées avec le moteur
      // Python pour une information que personne ne lit. La production
      // mono-secteur ne bouge pas pour un confort qu'elle n'a pas.
      const windowMinutes = Math.max(0, latestEndMinutes - earliestStartMinutes)
      const maximumMinutes = available
        ? Math.min(
            employee.maximumDailyMinutes,
            input.settings.maximumDailyMinutes ?? Number.POSITIVE_INFINITY,
            input.store.planningSettings.maxDailyDuration ?? input.store.planningSettings.maxShiftDuration ?? Number.POSITIVE_INFINITY,
            windowMinutes
          )
        : 0

      // Les règles fixes ne s'appliquent qu'aux jours réellement travaillés :
      // imposer une ouverture un jour de repos serait une contradiction que
      // personne n'a écrite.
      const fixed = constraintsByEmployee.get(String(employee.id))
      employeeDays.push({
        employeeId: employee.id,
        date: day.date,
        available,
        mandatory: available && mandatoryEverywhere,
        fixedRest,
        earliestStartMinutes,
        latestEndMinutes,
        maximumMinutes,
        ...(available && fixed?.exactStart != null ? { fixedStartMinutes: fixed.exactStart } : {}),
        ...(available && fixed?.exactEnd != null ? { fixedEndMinutes: fixed.exactEnd } : {}),
        ...(available && fixed?.mustOpenDays.includes(day.weekDay) ? { mustOpen: true } : {}),
        ...(available && fixed?.mustCloseDays.includes(day.weekDay) ? { mustClose: true } : {}),
        unavailableReason: available
          ? undefined
          : day.closed
            ? "closed"
            : fixedRest
              ? "fixed-rest"
              : !contracted
                ? "not-contracted"
                : absent
                  ? "absence"
                  : "holiday",
      })
    }
  }

  // ── Demand ────────────────────────────────────────────────────────────────
  const dateSet = new Set<IsoDate>(dates)
  const dayByDate = new Map<string, PlanningDayV3>(days.map((day) => [day.date, day]))
  const sectorRequirements = new Set(sector.requirementIds.map(String))
  const demandSlots: PlanningDemandSlotV3[] = []
  for (const requirement of input.demand.requirements) {
    if (sectorRequirements.size > 0 && !sectorRequirements.has(String(requirement.id))) continue
    if (!dateSet.has(requirement.window.date)) continue
    const startMinutes = minutesOfDay(requirement.window.start)
    const endMinutes = minutesOfDay(requirement.window.end)
    if (startMinutes === null || endMinutes === null) {
      fail({
        code: "malformed_requirement_window",
        date: requirement.window.date,
        path: `demand.requirements.${String(requirement.id)}`,
        message: `Le besoin ${String(requirement.id)} n'a pas une fenêtre "HH:mm" valide.`,
      })
      continue
    }
    const span = intervalMinutes(
      requirement.window.start,
      requirement.window.end,
      requirement.window.endDayOffset ?? 0
    )
    if (span === null) {
      fail({
        code: "empty_requirement_window",
        date: requirement.window.date,
        path: `demand.requirements.${String(requirement.id)}`,
        message: `Le besoin ${String(requirement.id)} a une durée nulle ou négative.`,
      })
      continue
    }
    // `span` rather than the parsed end: it is the one that honours
    // `endDayOffset`, so a window crossing midnight lands on the right minute.
    const slotEndMinutes = startMinutes + span
    const floor = presenceFloorFor(
      sector.minimumPresence,
      dayByDate.get(requirement.window.date),
      startMinutes,
      slotEndMinutes
    )
    demandSlots.push({
      id: String(requirement.id),
      date: requirement.window.date,
      startMinutes,
      endMinutes: slotEndMinutes,
      requiredEmployees: requirement.minEmployees,
      // Absent when the sector declares no floor covering this slot. Absent is
      // not zero: a slot with no floor is one no schedule can be REFUSED over,
      // while a declared zero would be a deliberate statement that nobody needs
      // to be there.
      ...(floor === null ? {} : { hardMinimumEmployees: floor }),
      maximumEmployees: requirement.maxEmployees ?? null,
    })
  }
  demandSlots.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.startMinutes - right.startMinutes ||
      left.id.localeCompare(right.id)
  )

  // ── Rules ─────────────────────────────────────────────────────────────────
  if (input.settings.minimumRestMinutes === undefined) {
    fail({
      code: "minimum_rest_missing",
      path: "settings.minimumRestMinutes",
      message: "Le repos minimum entre deux journées est obligatoire en V3.",
    })
  }
  if (!sector.minimumShiftDuration) {
    fail({
      code: "minimum_shift_missing",
      path: `business.sectors.${sector.id}.minimumShiftDuration`,
      message: `Le secteur « ${sector.name} » ne définit pas de durée minimale de shift.`,
    })
  }

  // Every advanced rule now has a home in the sector configuration. Each is read
  // with `??` and falls back to what the store — or, failing that, this builder —
  // used to supply, so a caller that predates the « Contraintes avancées » block
  // still poses exactly the problem it used to.
  const rules: PlanningRulesV3 = {
    minimumShiftMinutes: sector.minimumShiftDuration,
    // ── La JOURNÉE, pauses comprises ──────────────────────────────────────
    //
    // Le rayon plafonne la journée ; le magasin garde son mot, mais avec le
    // champ qui parle de la JOURNÉE. `maxShiftDuration` parle d'une traite et
    // n'a rien à faire ici : l'employer revenait à interdire les journées de
    // 10 h coupées à un magasin qui écrit « 8 h d'affilée, 10 h avec coupure ».
    //
    // Il reste le repli pour une configuration qui ne dit rien de la journée —
    // c'est le comportement historique, et il ne change donc rien pour elle.
    maximumShiftMinutes: Math.min(
      sector.maximumDailyDuration ?? Number.POSITIVE_INFINITY,
      input.store.planningSettings.maxDailyDuration
        ?? input.store.planningSettings.maxShiftDuration
        ?? input.settings.maximumDailyMinutes
        ?? Number.POSITIVE_INFINITY
    ),
    minimumRestMinutes: sector.minimumRestMinutes ?? input.settings.minimumRestMinutes ?? 0,
    // No configuration field exists for this rule yet, so the value is derived
    // and tagged as such rather than left silently null.
    maximumConsecutiveWorkedDays: defaultMaximumConsecutiveWorkedDays(days),
    maximumConsecutiveWorkedDaysSource: "derived-fallback",
    splitShiftAllowed: sector.splitShiftAllowed,
    maximumSplitMinutes: sector.maximumSplitDuration,
    // The sector states the minimum gap; the store's split policy remains the
    // fallback for configurations written before the sector carried one.
    minimumSplitMinutes:
      sector.minimumSplitDuration ?? input.store.splitShiftPolicy?.minSplitDuration ?? null,
    // ── LA TRAITE, pauses exclues ─────────────────────────────────────────
    //
    // Le plafond du magasin arrive ICI, où il a toujours eu son sens. Il ne
    // s'ajoute que quand la configuration distingue les deux durées : sans
    // `maxDailyDuration`, elle n'a jamais exprimé qu'un seul plafond et le
    // déplacer relâcherait sa journée en douce.
    maximumContinuousMinutes: minimumOf([
      sector.maximumContinuousDuration,
      input.store.planningSettings.maxDailyDuration == null
        ? undefined
        : input.store.planningSettings.maxShiftDuration,
    ]),
    maximumSplitsPerDay: sector.maximumSplitsPerDay ?? null,
    minimumOpeningsPerDay: sector.minimumOpeningsPerDay ?? 1,
    exactClosingsPerDay: sector.requiredClosingsPerDay ?? 1,
    // Carried, never enforced. `null` when the sector declares no policy, so a
    // caller written before the block still poses a problem with no opinion on
    // fairness rather than one that silently opted out.
    closingFairness: sector.closingFairness ?? null,
  }
  // `Number.isFinite` and not `<= 0`: intersecting the sector's cap with the
  // store's uses infinity for "not stated", so a problem where NEITHER states a
  // ceiling comes out infinite rather than zero, and must still be refused.
  if (!Number.isFinite(rules.maximumShiftMinutes) || rules.maximumShiftMinutes <= 0) {
    fail({
      code: "maximum_shift_missing",
      path: "store.planningSettings.maxShiftDuration",
      message: "La durée maximale d'un shift est obligatoire en V3.",
    })
  }
  if (rules.maximumContinuousMinutes !== null && rules.maximumContinuousMinutes !== undefined && rules.maximumContinuousMinutes > rules.maximumShiftMinutes) {
    fail({
      code: "continuous_exceeds_daily",
      path: `business.sectors.${sector.id}.maximumContinuousDuration`,
      message: `Le secteur « ${sector.name} » autorise ${rules.maximumContinuousMinutes} minutes en continu pour une journée plafonnée à ${rules.maximumShiftMinutes} minutes.`,
    })
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    problem: {
      version: PLANNING_PROBLEM_V3_VERSION,
      planningId: input.settings.planningId as PlanningId,
      sectorId: sector.id,
      period: { start, end },
      timeStepMinutes: step,
      employees,
      days,
      employeeDays,
      demandSlots,
      rules,
      // Only when something will actually balance. A problem that carries
      // history it will never consult would change identity — and therefore
      // invalidate every stored answer — for a week whose solution cannot
      // differ. Restricted to the roster, and sorted, so it stays canonical.
      ...(closingFairnessActive(rules.closingFairness)
        ? {
            closingHistory: (input.closingHistory ?? [])
              .filter((entry) => employees.some((employee) => employee.id === entry.employeeId))
              .map((entry) => ({
                employeeId: entry.employeeId,
                closings: entry.closings,
                opportunities: entry.opportunities,
                saturdayClosings: entry.saturdayClosings,
                saturdayOpportunities: entry.saturdayOpportunities,
              }))
              .sort((left, right) => String(left.employeeId).localeCompare(String(right.employeeId))),
          }
        : {}),
      objectives: PLANNING_OBJECTIVES_V3,
    },
  }
}

/**
 * Plancher de durée de shift appliqué à une génération commune, en minutes.
 *
 * Ce n'est PAS une règle de secteur : aucun rayon ne la déclare, et le mono-
 * secteur ne l'applique pas. Elle vient du fait qu'une zone commune fait
 * tourner un salarié entre plusieurs comptoirs et qu'un passage plus court que
 * quatre heures n'a pas de sens d'exploitation.
 *
 * Conséquence à connaître : un comptoir configuré avec un shift minimum de 3 h
 * se comporte différemment seul et en zone. La valeur est nommée ici pour que
 * ce soit une décision visible et non une constante enfouie ; la déplacer vers
 * la configuration magasin est une évolution produit, pas un correctif.
 */
/**
 * De combien un rayon peut fermer plus tard que son horaire nominal, en minutes.
 *
 * Le fermeur devait terminer à la minute exacte, ce qui ne lui laissait qu'un
 * seul horaire possible et bloquait des journées pour rien. Un rayon peut
 * s'attarder un peu — jamais au-delà de la fermeture du magasin, et jamais pour
 * fermer plus tôt : la couverture nominale reste due.
 */
export const SECTOR_CLOSING_EXTENSION_MINUTES = 45

export const MULTI_SECTOR_MINIMUM_SHIFT_MINUTES = 240

/**
 * Plafond de travail continu appliqué à une génération commune, en minutes.
 *
 * Même statut que ci-dessus, avec une asymétrie supplémentaire à assumer : en
 * mono-secteur, un rayon qui ne déclare aucun plafond continu n'en reçoit
 * aucun (`null`), alors qu'ici il en reçoit un de huit heures. Activer un
 * second comptoir ajoute donc une contrainte que la configuration n'exprime
 * nulle part. C'est délibérément conservé — resserrer ne peut pas rendre
 * illégal un planning déjà accepté — mais c'est écrit, pas caché.
 */
export const MULTI_SECTOR_MAXIMUM_CONTINUOUS_MINUTES = 480

/**
 * Construit le problème multi-secteur à partir des traductions mono-secteur.
 * Cette composition évite deux définitions divergentes des horaires, absences,
 * planchers et règles avancées. Les contrats sont ensuite dédupliqués : un
 * salarié partagé n'apporte son volume hebdomadaire qu'une seule fois.
 */
function buildMultiSectorProblemV3(
  input: PlanningGenerationInput,
  active: readonly NonNullable<NonNullable<PlanningGenerationInput["business"]>["sectors"]>[number][]
): PlanningProblemBuildResultV3 {
  const step = input.settings.timeIncrementMinutes ?? input.store.planningSettings.granularity ?? 15
  const parts: { sector: (typeof active)[number]; problem: PlanningProblemV3 }[] = []
  const errors: PlanningInfeasibilityV3[] = []

  for (const sector of active) {
    const built = buildPlanningProblemV3({
      ...input,
      business: { ...input.business, sectors: [{ ...sector, active: true }] },
      // L'historique existant n'est pas encore étiqueté par rayon. Le faire
      // circuler dans chaque sous-problème le compterait plusieurs fois.
      closingHistory: (input.closingHistory ?? []).filter((entry) => entry.sectorId === undefined || entry.sectorId === sector.id),
    })
    if (!built.ok) errors.push(...built.errors)
    else parts.push({ sector, problem: built.problem })
  }
  if (errors.length > 0) return { ok: false, errors }

  // ── Présence obligatoire : une zone, une réponse ──────────────────────────
  //
  // `workEveryNonFixedRestDay` décide si un jour disponible est TRAVAILLÉ ou
  // seulement travaillable. Le moteur ne sait pas traiter un jour optionnel :
  // il choisit les durées en supposant que le support de la matrice est fixé
  // par la seule disponibilité, et refuse la génération entière quand ce n'est
  // pas le cas.
  //
  // Quand les comptoirs répondent différemment, un salarié rattaché au seul
  // comptoir permissif obtient exactement ce jour optionnel, et la génération
  // s'arrêtait sur `optional-work-days-not-supported` : un message qui décrit
  // une limite du solveur sans nommer le comptoir à corriger. La contradiction
  // se voit ici, dans la configuration, alors disons-la ici.
  const mandatoryGroups = new Map<boolean, string[]>()
  for (const sector of active) {
    const flag = sector.workEveryNonFixedRestDay === true
    mandatoryGroups.set(flag, [...(mandatoryGroups.get(flag) ?? []), sector.name])
  }
  if (mandatoryGroups.size > 1) {
    return {
      ok: false,
      errors: [{
        code: "incompatible_multi_sector_mandatory_presence",
        path: "business.sectors",
        message:
          `Les rayons sélectionnés ne s'accordent pas sur la présence obligatoire : `
          + `${(mandatoryGroups.get(true) ?? []).join(", ")} impose de travailler chaque jour non repos, `
          + `${(mandatoryGroups.get(false) ?? []).join(", ")} ne l'impose pas. `
          + `Harmonisez « travaille tous les jours hors repos fixe » avant la génération commune. `
          + `Le planning affiché n'a pas été modifié.`,
      }],
    }
  }

  const employeeById = new Map<string, PlanningEmployeeV3>()
  for (const { problem } of parts) {
    for (const employee of problem.employees) {
      const id = String(employee.id)
      const allowed = active
        .filter((sector) => sector.assignedEmployeeIds.some((value) => String(value) === id))
        .map((sector) => sector.id)
      const preferred = input.business?.employeePreferences
        ?.find((entry) => String(entry.employeeId) === id)
        ?.sectorIds?.filter((sectorId) => allowed.includes(sectorId))
      const existing = employeeById.get(id)
      if (
        existing
        && (existing.maximumOpenings !== employee.maximumOpenings
          || existing.maximumClosings !== employee.maximumClosings)
      ) {
        return {
          ok: false,
          errors: [{
            code: "incompatible_multi_sector_employee_caps",
            path: `employees.${id}`,
            message: `${employee.firstName} ${employee.lastName} reçoit des plafonds d'ouvertures ou fermetures différents selon les rayons. Harmonisez-les avant la génération commune ; aucun plafond Drive n'a été remplacé.`,
          }],
        }
      }
      employeeById.set(id, {
        ...employee,
        allowedSectorIds: [...(preferred ?? []), ...allowed.filter((id) => !preferred?.includes(id))],
      })
    }
  }
  const employees = [...employeeById.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (employees.length === 0) {
    return { ok: false, errors: [{ code: "no_assigned_employee", path: "business.sectors", message: "Aucun salarié actif n'est affecté aux rayons sélectionnés." }] }
  }

  const baseDates = parts[0].problem.days.map((day) => day.date)
  const sectorModels = parts.map(({ sector, problem }) => ({
    id: sector.id,
    name: sector.name,
    closingFairness: problem.rules.closingFairness,
    splitRules: {
      splitShiftAllowed: problem.rules.splitShiftAllowed,
      minimumSplitMinutes: problem.rules.minimumSplitMinutes ?? null,
      maximumSplitMinutes: problem.rules.maximumSplitMinutes,
      maximumSplitsPerDay: problem.rules.maximumSplitsPerDay ?? null,
    },
    days: problem.days.map((day) => ({
      date: day.date,
      closed: day.closed,
      opensAtMinutes: day.opensAtMinutes,
      closesAtMinutes: day.closesAtMinutes,
      minimumOpenings: problem.rules.minimumOpeningsPerDay,
      exactClosings: problem.rules.exactClosingsPerDay,
      latestCloseMinutes: latestCloseFor(input, day),
    })),
  }))

  const totalContractMinutes = employees.reduce((sum, employee) => sum + employee.contractMinutes, 0)
  // ── Le volume du jour suit le BESOIN des comptoirs ────────────────────────
  //
  // Il suivait une répartition hebdomadaire en pourcentages, indifférente à ce
  // que les rayons demandent réellement. Un jour où un comptoir ouvre trois
  // heures de plus recevait la même part que les autres, et ces trois heures
  // devaient être volées à une autre journée.
  //
  // Ici, ce qu'un jour réclame est la somme des minutes de présence que ses
  // comptaires exigent — donc trois heures de plus sur un rayon un mardi
  // remontent le mardi, et rien d'autre. La répartition configurée reste le
  // repli pour un jour dont aucun comptoir n'exprime de besoin : sans demande,
  // il n'y a rien à suivre.
  const weights = new Map<WeekDay, number>(WEEK_DAYS.map((day) => [day, 0]))
  const dayOfDate = new Map(parts[0].problem.days.map((day) => [day.date, day.weekDay]))
  for (const { problem } of parts) {
    for (const slot of problem.demandSlots) {
      const weekDay = dayOfDate.get(slot.date)
      if (weekDay === undefined) continue
      const need = (slot.endMinutes - slot.startMinutes) * slot.requiredEmployees
      weights.set(weekDay, (weights.get(weekDay) ?? 0) + need)
    }
  }
  if ([...weights.values()].every((value) => value === 0)) {
    for (const { problem } of parts) {
      for (const day of problem.days) {
        // Keep the sector's volume. Normalising every sector independently made
        // a ten-hour aisle influence the week as much as the full Drive.
        weights.set(day.weekDay, (weights.get(day.weekDay) ?? 0) + day.budgetMinutes)
      }
    }
  }
  // Un jour ouvert que la demande ignore doit garder de quoi tenir ses rayons :
  // lui laisser zéro rendrait sa journée impossible, pas économe.
  for (const day of parts[0].problem.days) {
    if (day.closed || (weights.get(day.weekDay) ?? 0) > 0) continue
    weights.set(day.weekDay, employees.length * MULTI_SECTOR_MINIMUM_SHIFT_MINUTES)
  }
  const weightTotal = [...weights.values()].reduce((sum, value) => sum + value, 0)
  const distribution = Object.fromEntries(
    WEEK_DAYS.map((day) => [day, weightTotal > 0 ? ((weights.get(day) ?? 0) * 100) / weightTotal : 0])
  ) as Record<WeekDay, number>
  // Les pourcentages viennent d'une division : leur somme flotte à 1e-14 près,
  // et `computeDailyBudgets` exige 100 pile. Le reliquat va au jour le plus
  // chargé, où il est proportionnellement le plus petit.
  const heaviest = WEEK_DAYS.reduce((best, day) =>
    distribution[day] > distribution[best] ? day : best
  )
  const drift = 100 - WEEK_DAYS.reduce((sum, day) => sum + distribution[day], 0)
  if (drift !== 0 && distribution[heaviest] > 0) distribution[heaviest] += drift
  const combinedBudgets = computeDailyBudgets(totalContractMinutes, distribution, step)
  if (!combinedBudgets.ok) {
    return { ok: false, errors: [{ code: "daily_budget_undefined", path: "business.sectors", message: combinedBudgets.error }] }
  }
  const budgetByDay = new Map(combinedBudgets.budgets.map((entry) => [entry.day, entry.budgetMinutes]))

  const days: PlanningDayV3[] = baseDates.map((date) => {
    const candidates = parts.map(({ problem }) => problem.days.find((day) => day.date === date)!).filter((day) => !day.closed)
    const reference = parts[0].problem.days.find((day) => day.date === date)!
    return {
      date,
      weekDay: reference.weekDay,
      weekKey: reference.weekKey,
      closed: candidates.length === 0,
      opensAtMinutes: candidates.length ? Math.min(...candidates.map((day) => day.opensAtMinutes!)) : null,
      closesAtMinutes: candidates.length ? Math.max(...candidates.map((day) => day.closesAtMinutes!)) : null,
      budgetMinutes: candidates.length ? (budgetByDay.get(reference.weekDay) ?? 0) : 0,
      ...(candidates.some((day) => day.budgetMode === "target")
        ? { budgetMode: "target" as const }
        : {}),
    }
  })

  const employeeDays: PlanningEmployeeDayV3[] = []
  for (const employee of employees) {
    for (const day of days) {
      const entries = parts
        .filter(({ sector }) => employee.allowedSectorIds?.includes(sector.id))
        .map(({ problem }) => problem.employeeDays.find((entry) => entry.employeeId === employee.id && entry.date === day.date))
        .filter((entry): entry is PlanningEmployeeDayV3 => entry !== undefined)
      const available = entries.some((entry) => entry.available)
      const availableEntries = entries.filter((entry) => entry.available)
      const earliest = available ? Math.min(...availableEntries.map((entry) => entry.earliestStartMinutes)) : 0
      const latest = available ? Math.max(...availableEntries.map((entry) => entry.latestEndMinutes)) : 0
      const availableMinutes = available ? mergedIntervalMinutes(
        availableEntries.map((entry) => [entry.earliestStartMinutes, entry.latestEndMinutes] as const)
      ) : 0
      // Le plafond quotidien du salarié : celui des rayons OÙ IL TRAVAILLE.
      //
      // Il était global, donc un rayon strict le baissait pour tout le monde.
      // Sur une zone réelle : Poisson ouvre 07:00–18:00 et autorise 10 h par
      // jour, Fromage n'en autorise que 8 — et l'unique poissonnière se
      // retrouvait plafonnée à 8 h par un comptoir où elle ne met jamais les
      // pieds, ce qui rendait sa journée impossible à tenir et faisait déclarer
      // le rayon infaisable. Exactement la faute déjà corrigée pour les
      // coupures, jamais appliquée aux durées.
      // ── La provenance se lit sur les valeurs BRUTES ────────────────────────
      //
      // Surtout pas sur `problem.rules.maximumShiftMinutes` d'un sous-problème :
      // celui-là vaut déjà `min(durée max du rayon, plafond du magasin)`, donc
      // l'étiqueter « rayon » désigne le magasin une fois sur deux. C'est la
      // cinquième fois que le même piège se referme — un agrégat ne peut pas
      // porter le nom d'un seul de ses opérandes.
      //
      // Ces cinq-là sont des réglages que quelqu'un a saisis quelque part, et
      // chacun a son propre écran. Le minimum désigne donc toujours un endroit
      // réel à aller corriger.
      const ownRawSectorCap = Math.min(
        ...active
          .filter((sector) => employee.allowedSectorIds?.includes(sector.id))
          .map((sector) => sector.maximumDailyDuration ?? Number.POSITIVE_INFINITY)
      )
      const cap = dailyCapOf([
        { minutes: ownRawSectorCap, source: "sector" },
        { minutes: employee.maximumDailyMinutes, source: "contract" },
        { minutes: input.settings.maximumDailyMinutes ?? Number.POSITIVE_INFINITY, source: "settings" },
        { minutes: input.store.planningSettings.maxDailyDuration ?? input.store.planningSettings.maxShiftDuration ?? Number.POSITIVE_INFINITY, source: "store" },
        { minutes: availableMinutes, source: "window" },
      ])
      employeeDays.push({
        employeeId: employee.id,
        date: day.date,
        available,
        mandatory: availableEntries.some((entry) => entry.mandatory),
        fixedRest: entries.some((entry) => entry.fixedRest),
        earliestStartMinutes: earliest,
        latestEndMinutes: latest,
        maximumMinutes: available ? cap.minutes : 0,
        ...(available ? { maximumMinutesSource: cap.source } : {}),
        // Les règles fixes sont propres au SALARIÉ, pas au rayon : tous les
        // sous-problèmes portent donc la même valeur, et la première suffit.
        ...(availableEntries[0]?.fixedStartMinutes != null
          ? { fixedStartMinutes: availableEntries[0].fixedStartMinutes } : {}),
        ...(availableEntries[0]?.fixedEndMinutes != null
          ? { fixedEndMinutes: availableEntries[0].fixedEndMinutes } : {}),
        ...(availableEntries.some((entry) => entry.mustOpen) ? { mustOpen: true } : {}),
        ...(availableEntries.some((entry) => entry.mustClose) ? { mustClose: true } : {}),
        unavailableReason: available ? undefined : entries[0]?.unavailableReason ?? "no-authorized-sector-open",
      })
    }
  }

  const minFinite = (values: readonly (number | null | undefined)[]) => {
    const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    return finite.length ? Math.min(...finite) : null
  }
  // General day limits remain the safe intersection. Split bounds are the
  // permissive envelope used only to GENERATE candidates; each candidate is
  // then checked against the rules of the sectors it actually works. Requiring
  // every selected counter to allow splits made Poisson unable to use a split
  // simply because Fromage forbade them, even on a Poisson-only day.
  const splitParts = parts.filter(({ problem }) => problem.rules.splitShiftAllowed)
  const splitShiftAllowed = splitParts.length > 0
  const nullableMinimum = (values: readonly (number | null | undefined)[]) =>
    values.some((value) => value == null)
      ? null
      : Math.min(...values.filter((value): value is number => typeof value === "number"))
  const nullableMaximum = (values: readonly (number | null | undefined)[]) =>
    values.some((value) => value == null)
      ? null
      : Math.max(...values.filter((value): value is number => typeof value === "number"))
  const rules: PlanningRulesV3 = {
    minimumShiftMinutes: Math.max(
      MULTI_SECTOR_MINIMUM_SHIFT_MINUTES,
      ...parts.map(({ problem }) => problem.rules.minimumShiftMinutes)
    ),
    // ENVELOPPE, pas intersection — même traitement que les coupures juste en
    // dessous, et pour la même raison.
    //
    // Ce plafond ne borne plus personne à lui seul : la limite qui s'applique
    // réellement à un salarié est posée par rayon dans
    // `employeeDays[].maximumMinutes`, à partir des seuls comptoirs où il est
    // autorisé. Le garder en intersection revenait à faire décider la journée
    // de la poissonnière par le rayon Fromage.
    maximumShiftMinutes: Math.max(...parts.map(({ problem }) => problem.rules.maximumShiftMinutes)),
    minimumRestMinutes: Math.max(...parts.map(({ problem }) => problem.rules.minimumRestMinutes)),
    // Le repli structurel se calcule sur la ZONE, jamais par intersection.
    //
    // `defaultMaximumConsecutiveWorkedDays` promet d'être NON CONTRAIGNANT :
    // c'est la plus longue série de jours ouverts, donc aucun planning
    // réalisable ne peut la dépasser. La promesse tient pour un rayon et
    // l'intersection la détruisait. Sur une semaine réelle : Poisson ferme le
    // mercredi et Fromage le jeudi, chacun n'a donc que 3 jours ouverts
    // d'affilée, `min` retenait 3 — et l'imposait à des salariés que leur
    // disponibilité oblige à travailler 6 jours consécutifs sur des comptoirs
    // ouverts toute la semaine. Tout planning violait la règle, l'évaluateur
    // les rejetait tous, et le moteur rendait « aucun planning légal trouvé »
    // sans jamais pouvoir dire pourquoi.
    //
    // Une valeur réellement CONFIGURÉE reste une règle métier et continue de
    // s'intersecter : là, le rayon le plus strict a raison de contraindre.
    maximumConsecutiveWorkedDays: minFinite([
      ...parts
        .filter(({ problem }) => problem.rules.maximumConsecutiveWorkedDaysSource === "configured")
        .map(({ problem }) => problem.rules.maximumConsecutiveWorkedDays),
      defaultMaximumConsecutiveWorkedDays(days),
    ]),
    maximumConsecutiveWorkedDaysSource: parts.some(({ problem }) => problem.rules.maximumConsecutiveWorkedDaysSource === "configured") ? "configured" : "derived-fallback",
    splitShiftAllowed,
    maximumSplitMinutes: splitShiftAllowed
      ? nullableMaximum(splitParts.map(({ problem }) => problem.rules.maximumSplitMinutes))
      : null,
    minimumSplitMinutes: splitShiftAllowed
      ? nullableMinimum(splitParts.map(({ problem }) => problem.rules.minimumSplitMinutes))
      : null,
    maximumContinuousMinutes: Math.min(
      MULTI_SECTOR_MAXIMUM_CONTINUOUS_MINUTES,
      ...parts
        .map(({ problem }) => problem.rules.maximumContinuousMinutes)
        .filter((value): value is number => typeof value === "number")
    ),
    maximumSplitsPerDay: splitShiftAllowed
      ? nullableMaximum(splitParts.map(({ problem }) => problem.rules.maximumSplitsPerDay))
      : null,
    // Les responsabilités sont imposées par rayon dans le MILP de placement.
    minimumOpeningsPerDay: 0,
    exactClosingsPerDay: 0,
    closingFairness: null,
  }

  const commonRuleConflict = commonMultiSectorRuleConflict(parts, rules)
  if (commonRuleConflict !== null) {
    return {
      ok: false,
      errors: [{
        code: "incompatible_multi_sector_rules",
        path: "business.sectors",
        message: commonRuleConflict,
      }],
    }
  }

  return {
    ok: true,
    problem: {
      version: PLANNING_PROBLEM_V3_VERSION,
      planningId: input.settings.planningId as PlanningId,
      sectorId: active[0].id,
      sectors: sectorModels,
      period: { start: input.settings.period.start, end: input.settings.period.end },
      timeStepMinutes: step,
      employees,
      days,
      employeeDays,
      demandSlots: parts.flatMap(({ sector, problem }) => problem.demandSlots.map((slot) => ({ ...slot, sectorId: sector.id }))),
      rules,
      closingHistory: parts.flatMap(({ sector, problem }) =>
        (problem.closingHistory ?? []).map((entry) => ({ ...entry, sectorId: sector.id }))
      ),
      objectives: PLANNING_MULTI_SECTOR_OBJECTIVES_V3,
    },
  }
}

function commonMultiSectorRuleConflict(
  parts: readonly { readonly sector: { readonly name: string }; readonly problem: PlanningProblemV3 }[],
  rules: PlanningRulesV3
): string | null {
  const selected = parts.map(({ sector }) => sector.name).join(", ")
  const sourceNames = (select: (rules: PlanningRulesV3) => number | null | undefined, value: number) =>
    parts.filter(({ problem }) => select(problem.rules) === value).map(({ sector }) => sector.name).join(", ")
  const conflict = (minimumLabel: string, minimum: number, minimumSources: string, maximumLabel: string, maximum: number, maximumSources: string) =>
    `Impossible de construire une règle commune pour ${selected} : ${minimumLabel} ${duration(minimum)} (${minimumSources}) dépasse ${maximumLabel} ${duration(maximum)} (${maximumSources}). Le planning affiché n'a pas été modifié.`

  // Par comptoir, et non plus sur l'enveloppe.
  //
  // `maximumShiftMinutes` est désormais le plus PERMISSIF des plafonds, donc le
  // comparer au minimum commun ne dirait plus rien : un comptoir plafonné sous
  // ce minimum ne peut accueillir aucun shift légal, et c'est lui qu'il faut
  // nommer, pas la zone.
  const tightest = parts
    .map(({ sector, problem }) => ({ name: sector.name, maximum: problem.rules.maximumShiftMinutes }))
    .sort((left, right) => left.maximum - right.maximum)[0]
  if (tightest !== undefined && rules.minimumShiftMinutes > tightest.maximum) {
    return conflict(
      "la durée minimale retenue de",
      rules.minimumShiftMinutes,
      sourceNames((candidate) => candidate.minimumShiftMinutes, rules.minimumShiftMinutes) || "minimum légal de 4 h",
      "la durée maximale du rayon le plus strict, de",
      tightest.maximum,
      tightest.name
    )
  }
  if (rules.maximumContinuousMinutes != null && rules.minimumShiftMinutes > rules.maximumContinuousMinutes) {
    return conflict(
      "la durée minimale retenue de",
      rules.minimumShiftMinutes,
      sourceNames((candidate) => candidate.minimumShiftMinutes, rules.minimumShiftMinutes) || "minimum légal de 4 h",
      "la durée continue maximale retenue de",
      rules.maximumContinuousMinutes,
      sourceNames((candidate) => candidate.maximumContinuousMinutes, rules.maximumContinuousMinutes) || "limite commune de 8 h"
    )
  }
  if (
    rules.splitShiftAllowed
    && rules.minimumSplitMinutes != null
    && rules.maximumSplitMinutes != null
    && rules.minimumSplitMinutes > rules.maximumSplitMinutes
  ) {
    return conflict(
      "la coupure minimale retenue de",
      rules.minimumSplitMinutes,
      sourceNames((candidate) => candidate.minimumSplitMinutes, rules.minimumSplitMinutes),
      "la coupure maximale retenue de",
      rules.maximumSplitMinutes,
      sourceNames((candidate) => candidate.maximumSplitMinutes, rules.maximumSplitMinutes)
    )
  }
  return null
}

/**
 * Jusqu'à quand ce rayon peut s'attarder, ce jour-là.
 *
 * Son horaire nominal plus l'extension tolérée, plafonné par la fermeture du
 * MAGASIN — que seul ce constructeur connaît, le problème ne la transporte pas.
 * Un magasin qui n'affiche pas d'horaire ce jour-là ne plafonne rien : le rayon
 * fait autorité, comme partout ailleurs dans ce fichier.
 */
function latestCloseFor(input: PlanningGenerationInput, day: PlanningDayV3): number | null {
  if (day.closed || day.closesAtMinutes === null) return day.closesAtMinutes
  const storeHours = input.store.openingHours.find((item) => item.day === day.weekDay)
  const storeCloses =
    storeHours && !storeHours.closed && storeHours.closesAt
      ? minutesOfDay(storeHours.closesAt)
      : null
  const extended = day.closesAtMinutes + SECTOR_CLOSING_EXTENSION_MINUTES
  return storeCloses === null ? extended : Math.max(day.closesAtMinutes, Math.min(extended, storeCloses))
}

/**
 * Le plafond du jour, ET le réglage qui l'a produit.
 *
 * Cinq entrées, cinq écrans différents pour les corriger. Renvoyer le seul
 * nombre laissait le diagnostic deviner, et il devinait mal : « plafond fixé
 * par la configuration du magasin » s'affichait alors qu'un RAYON plafonnait,
 * envoyant modifier un réglage qui ne changeait rien.
 *
 * En cas d'égalité, l'ordre de cette liste tranche, du plus spécifique au plus
 * général : c'est celui qu'il est le plus naturel d'aller corriger.
 */
function dailyCapOf(
  candidates: readonly { readonly minutes: number; readonly source: PlanningDailyCapSourceV3 }[]
): { readonly minutes: number; readonly source: PlanningDailyCapSourceV3 } {
  return candidates.reduce((best, candidate) =>
    candidate.minutes < best.minutes ? candidate : best
  )
}

/** Le plus petit des plafonds réellement déclarés, ou `null` si aucun ne l'est. */
function minimumOf(values: readonly (number | null | undefined)[]): number | null {
  const declared = values.filter((value): value is number => typeof value === "number")
  return declared.length === 0 ? null : Math.min(...declared)
}

function mergedIntervalMinutes(intervals: readonly (readonly [number, number])[]): number {
  const sorted = intervals
    .filter(([start, end]) => end > start)
    .map(([start, end]) => [start, end] as [number, number])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])
  if (sorted.length === 0) return 0
  let total = 0
  let [start, end] = sorted[0]
  for (const [nextStart, nextEnd] of sorted.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd)
    else {
      total += end - start
      start = nextStart
      end = nextEnd
    }
  }
  return total + end - start
}

/**
 * STRUCTURAL FALLBACK for the consecutive-worked-days cap.
 *
 * This is not a business rule, and it is not a legal or regulatory limit. It is
 * the longest run of consecutive OPEN days in the horizon — a fact about the
 * opening pattern and nothing more.
 *
 * It exists only because the application model currently has no configuration
 * field for this rule: there is nothing to read. Leaving `null` would drop the
 * constraint silently, so the builder emits this value instead and tags it
 * `derived-fallback` so no caller can mistake it for a configured rule.
 *
 * It is deliberately NON-BINDING: being the structural maximum, it can never
 * make a previously feasible schedule infeasible, so it changes no planning.
 *
 * When the store configuration gains a real field, this function must be
 * replaced by reading that configuration, and a missing value must then raise a
 * structured error like every other missing input in this builder — not fall
 * back here.
 */
export function defaultMaximumConsecutiveWorkedDays(
  days: readonly { readonly closed: boolean }[]
): number {
  let longest = 0
  let current = 0
  for (const day of days) {
    current = day.closed ? 0 : current + 1
    longest = Math.max(longest, current)
  }
  return Math.max(1, longest)
}

/**
 * The unbreakable floor covering one demand slot, or null when none does.
 *
 * A floor applies to a slot only when the slot lies ENTIRELY inside the floor's
 * window. Partial overlap is deliberately not enough: a floor covering half a
 * slot says nothing about the other half, and applying it to the whole slot
 * would demand presence at moments the sector never asked for. The demand model
 * takes the maximum across every slot covering a given minute, so a narrower
 * peak floor still wins where it belongs — see `demand.py` in the HiGHS
 * experiment for the atomic reading.
 *
 * Several floors may match; the largest wins, because a floor is a minimum and
 * two minimums over the same window are satisfied only by the higher one.
 */
function presenceFloorFor(
  floors: readonly SectorPresenceFloor[] | undefined,
  day: PlanningDayV3 | undefined,
  startMinutes: number,
  endMinutes: number
): number | null {
  if (!floors || floors.length === 0 || !day || day.closed) return null

  let best: number | null = null
  for (const floor of floors) {
    if (floor.day !== undefined && floor.day !== day.weekDay) continue

    const from = floor.from === undefined ? day.opensAtMinutes : minutesOfDay(floor.from)
    const to = floor.to === undefined ? day.closesAtMinutes : minutesOfDay(floor.to)
    if (from === null || to === null) continue
    if (startMinutes < from || endMinutes > to) continue

    best = best === null ? floor.employees : Math.max(best, floor.employees)
  }
  return best
}

/**
 * True when at least one balance is switched on.
 *
 * A declared policy with both flags false is a manager who looked and chose not
 * to balance. That must behave exactly like no policy at all — same problem,
 * same fingerprint, same answer — which is what the « règle désactivée :
 * résultat inchangé » requirement means in practice.
 */
export function closingFairnessActive(
  fairness: { readonly balanceClosings: boolean; readonly balanceSaturdayClosings: boolean } | null | undefined
): boolean {
  return fairness !== null && fairness !== undefined && (fairness.balanceClosings || fairness.balanceSaturdayClosings)
}

/** Minutes since midnight → "HH:mm", for error messages only. */
function clock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

/** Duration in minutes -> compact French text, for error messages only. */
function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${remainder} min`
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder}`
}

/** "HH:mm" → minutes since midnight, or null when malformed. */
function minutesOfDay(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [hours, minutes] = value.split(":")
  return Number(hours) * 60 + Number(minutes)
}

/** Convenience accessor used by the validator and the tests. */
export function employeeDayOf(
  problem: PlanningProblemV3,
  employeeId: EmployeeId,
  date: IsoDate
): PlanningEmployeeDayV3 | undefined {
  return problem.employeeDays.find(
    (entry) => entry.employeeId === employeeId && entry.date === date
  )
}
