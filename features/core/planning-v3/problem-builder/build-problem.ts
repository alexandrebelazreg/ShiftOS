import type { EmployeeId, IsoDate, PlanningId, WeekDay } from "@/features/core/models"
import { WEEK_DAYS } from "@/features/core/models"
import { enumerateDates, intervalMinutes, isoWeekKey, weekDayOf } from "@/features/core/shared"

import type { PlanningGenerationInput } from "@/features/core/planning-generator/types/generation-input"

import { computeDailyBudgets } from "@/features/core/planning-v3/problem-builder/daily-budget"
import {
  PLANNING_OBJECTIVES_V3,
  PLANNING_PROBLEM_V3_VERSION,
  type PlanningDayV3,
  type PlanningDemandSlotV3,
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
    return {
      ok: false,
      errors: [
        {
          code: "multiple_active_sectors",
          path: "business.sectors",
          message: `Planning V3A traite un seul secteur actif à la fois, ${active.length} reçus (${active.map((sector) => sector.id).join(", ")}).`,
        },
      ],
    }
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

  const constraintsByEmployee = new Map<string, { fixedRestDays: WeekDay[]; maxOpenings: number | null; maxClosings: number | null }>()
  for (const employee of roster) {
    constraintsByEmployee.set(String(employee.id), {
      fixedRestDays: [],
      maxOpenings: null,
      maxClosings: null,
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
      maximumOpenings: bucket?.maxOpenings ?? null,
      maximumClosings: bucket?.maxClosings ?? null,
      prefersOpening: false,
      prefersClosing: preference?.prefersClosing ?? false,
    })
  }

  // ── Days and exact daily budgets ──────────────────────────────────────────
  const totalContractMinutes = employees.reduce((sum, employee) => sum + employee.contractMinutes, 0)
  const budgets = computeDailyBudgets(totalContractMinutes, sector.weeklyDistribution, step)
  if (!budgets.ok) {
    fail({
      code: "daily_budget_undefined",
      path: `business.sectors.${sector.id}.weeklyDistribution`,
      message: budgets.error,
    })
  }
  const budgetByDay = new Map(
    budgets.ok ? budgets.budgets.map((budget) => [budget.day, budget.budgetMinutes]) : []
  )

  const days: PlanningDayV3[] = []
  for (const date of dates) {
    const weekDay = weekDayOf(date)
    const storeHours = input.store.openingHours.find((item) => item.day === weekDay)
    const sectorHours = sector.hours?.find((item) => item.day === weekDay)
    const storeClosed = !storeHours || storeHours.closed || !storeHours.opensAt || !storeHours.closesAt
    const sectorClosed = sectorHours ? sectorHours.closed : false
    const closed = storeClosed || sectorClosed

    let opensAtMinutes: number | null = null
    let closesAtMinutes: number | null = null
    if (!closed && storeHours?.opensAt && storeHours.closesAt) {
      const storeOpen = minutesOfDay(storeHours.opensAt)
      const storeClose = minutesOfDay(storeHours.closesAt)
      const sectorOpen = sectorHours ? minutesOfDay(sectorHours.opensAt) : storeOpen
      const sectorClose = sectorHours ? minutesOfDay(sectorHours.closesAt) : storeClose
      if (storeOpen === null || storeClose === null || sectorOpen === null || sectorClose === null) {
        fail({
          code: "malformed_hours",
          date,
          path: `store.openingHours.${weekDay}`,
          message: `Les horaires du ${date} ne sont pas au format "HH:mm".`,
        })
      } else {
        // The sector may only operate inside the store's window.
        opensAtMinutes = Math.max(storeOpen, sectorOpen)
        closesAtMinutes = Math.min(storeClose, sectorClose)
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

    days.push({
      date,
      weekDay,
      weekKey: isoWeekKey(date),
      closed,
      opensAtMinutes,
      closesAtMinutes,
      budgetMinutes,
    })
  }

  // ── Availability, per employee and per date ───────────────────────────────
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
      const holiday = holidays.has(day.date)
      const available = !day.closed && contracted && !fixedRest && !absent && !holiday

      const windowMinutes =
        day.opensAtMinutes !== null && day.closesAtMinutes !== null
          ? day.closesAtMinutes - day.opensAtMinutes
          : 0
      const maximumMinutes = available
        ? Math.min(
            employee.maximumDailyMinutes,
            input.settings.maximumDailyMinutes ?? Number.POSITIVE_INFINITY,
            input.store.planningSettings.maxShiftDuration ?? Number.POSITIVE_INFINITY,
            windowMinutes
          )
        : 0

      employeeDays.push({
        employeeId: employee.id,
        date: day.date,
        available,
        mandatory: available && mandatoryEverywhere,
        fixedRest,
        earliestStartMinutes: day.opensAtMinutes ?? 0,
        latestEndMinutes: day.closesAtMinutes ?? 0,
        maximumMinutes,
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
    demandSlots.push({
      id: String(requirement.id),
      date: requirement.window.date,
      startMinutes,
      endMinutes: startMinutes + span,
      requiredEmployees: requirement.minEmployees,
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

  const rules: PlanningRulesV3 = {
    minimumShiftMinutes: sector.minimumShiftDuration,
    maximumShiftMinutes:
      input.store.planningSettings.maxShiftDuration ?? input.settings.maximumDailyMinutes ?? 0,
    minimumRestMinutes: input.settings.minimumRestMinutes ?? 0,
    // No configuration field exists for this rule yet, so the value is derived
    // and tagged as such rather than left silently null.
    maximumConsecutiveWorkedDays: defaultMaximumConsecutiveWorkedDays(days),
    maximumConsecutiveWorkedDaysSource: "derived-fallback",
    splitShiftAllowed: sector.splitShiftAllowed,
    maximumSplitMinutes: sector.maximumSplitDuration,
    minimumOpeningsPerDay: 1,
    exactClosingsPerDay: 1,
  }
  if (rules.maximumShiftMinutes <= 0) {
    fail({
      code: "maximum_shift_missing",
      path: "store.planningSettings.maxShiftDuration",
      message: "La durée maximale d'un shift est obligatoire en V3.",
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
      objectives: PLANNING_OBJECTIVES_V3,
    },
  }
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
