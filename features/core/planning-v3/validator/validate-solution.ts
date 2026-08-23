import type { IsoDate, WeekDay } from "@/features/core/models"
import { coverageDeficitMinutes, minimumConcurrentPresence } from "@/features/core/shared"

import type {
  PlanningDayV3,
  PlanningEmployeeV3,
  PlanningProblemV3,
} from "@/features/core/planning-v3/types/problem"
import type {
  PlanningSegmentV3,
  PlanningSolutionV3,
} from "@/features/core/planning-v3/types/solution"
import {
  PLANNING_VALIDATION_V3_VERSION,
  type PlanningMetricsV3,
  type PlanningRuleCodeV3,
  type PlanningValidationReportV3,
  type PlanningViolationSeverityV3,
  type PlanningViolationV3,
} from "@/features/core/planning-v3/types/validation"
import {
  closingLoadSpreadPermille,
  loadsAfterWeek,
  saturdayLoadsAfterWeek,
  weeklyClosingShare,
  type ClosingLoad,
} from "@/features/core/planning-v3/fairness/closing-load"
import {
  fingerprintProblem,
  fingerprintSolution,
} from "@/features/core/planning-v3/validator/fingerprint"
import {
  normalizedSectorAssignments,
  validateSectorAssignments,
} from "@/features/core/planning-v3/validator/sector-assignment-invariants"

/**
 * The independent Planning V3 validator.
 *
 * It receives a problem and a solution and NOTHING else, and it recomputes
 * every figure from those two inputs alone. It shares no code with any
 * generator: not the V2 business pipeline, not the weekly minute allocator,
 * not the weekly placement or repair passes, not the V2 candidate-plan
 * validator, and not the future V3 solver.
 *
 * That isolation is the whole point. A validator built from the generator's own
 * helpers agrees with the generator by construction, including when both are
 * wrong. This one is written to be able to disagree — where the generator
 * commits to a figure (`solution.declaredMetrics`), the validator recomputes it
 * from scratch and reports a blocking violation on any mismatch.
 *
 * Severity contract: a report carrying even one `blocking` violation describes
 * a solution that may never be published once V3 goes live.
 */
export function validatePlanningSolutionV3(
  problem: PlanningProblemV3,
  solution: PlanningSolutionV3
): PlanningValidationReportV3 {
  const violations: PlanningViolationV3[] = []
  const add = (
    rule: PlanningRuleCodeV3,
    severity: PlanningViolationSeverityV3,
    message: string,
    extra: Omit<PlanningViolationV3, "rule" | "severity" | "message"> = {}
  ) => violations.push({ rule, severity, message, ...extra })

  const employeeById = new Map(problem.employees.map((employee) => [String(employee.id), employee]))
  const dayByDate = new Map(problem.days.map((day) => [day.date, day]))
  // ── Structural integrity of the submitted solution ────────────────────────
  const worked = new Map<string, PlanningSegmentV3[]>()
  const assignmentByKey = new Map<string, PlanningSolutionV3["assignments"][number]>()
  for (const assignment of solution.assignments) {
    const employee = employeeById.get(String(assignment.employeeId))
    const day = dayByDate.get(assignment.date)
    if (!employee) {
      add("solution-integrity", "blocking", `La solution affecte un salarié inconnu du problème (${String(assignment.employeeId)}).`, { employeeId: assignment.employeeId, date: assignment.date })
      continue
    }
    if (!day) {
      add("solution-integrity", "blocking", `La solution affecte une date hors période (${assignment.date}).`, { employeeId: assignment.employeeId, date: assignment.date })
      continue
    }
    const key = `${String(assignment.employeeId)}|${assignment.date}`
    if (worked.has(key)) {
      add("solution-integrity", "blocking", `${employee.firstName} a plusieurs affectations pour le ${assignment.date}.`, { employeeId: assignment.employeeId, date: assignment.date })
      continue
    }
    worked.set(key, sortSegments(assignment.segments))
    assignmentByKey.set(key, assignment)
    for (const issue of validateSectorAssignments(problem, employee, assignment)) {
      add("sector-assignment", "blocking", `${employee.firstName} ${employee.lastName}, ${assignment.date} : ${issue.message}`, { employeeId: employee.id, date: assignment.date })
    }
  }

  for (const [key, segments] of worked) {
    const [employeeId, date] = splitKey(key)
    const employee = employeeById.get(employeeId)!
    for (const segment of segments) {
      if (segment.endMinutes <= segment.startMinutes) {
        add("solution-integrity", "blocking", `${employee.firstName} : segment de durée nulle ou négative le ${date}.`, { employeeId: employee.id, date })
      }
      if (
        segment.startMinutes % problem.timeStepMinutes !== 0 ||
        segment.endMinutes % problem.timeStepMinutes !== 0
      ) {
        add("time-step", "blocking", `${employee.firstName} : le segment ${format(segment)} du ${date} ne respecte pas le pas de ${problem.timeStepMinutes} minutes.`, { employeeId: employee.id, date })
      }
    }
    for (let index = 1; index < segments.length; index++) {
      if (segments[index].startMinutes < segments[index - 1].endMinutes) {
        add("solution-integrity", "blocking", `${employee.firstName} : segments qui se chevauchent le ${date}.`, { employeeId: employee.id, date })
      }
    }
  }

  // ── Recomputed metrics ────────────────────────────────────────────────────
  const dailyMinutesByEmployeeDate: Record<string, number> = {}
  const dailyMinutesByDate: Record<string, number> = {}
  const weeklyMinutesByEmployeeWeek: Record<string, number> = {}
  const openingsByEmployee: Record<string, number> = {}
  const closingsByEmployee: Record<string, number> = {}

  for (const employee of problem.employees) {
    openingsByEmployee[String(employee.id)] = 0
    closingsByEmployee[String(employee.id)] = 0
    for (const weekKey of new Set(problem.days.map((day) => day.weekKey))) {
      weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`] = 0
    }
  }
  for (const day of problem.days) dailyMinutesByDate[day.date] = 0

  for (const [key, segments] of worked) {
    const [employeeId, date] = splitKey(key)
    const day = dayByDate.get(date)!
    const minutes = totalMinutes(segments)
    dailyMinutesByEmployeeDate[key] = minutes
    dailyMinutesByDate[date] = (dailyMinutesByDate[date] ?? 0) + minutes
    const weekKey = `${employeeId}|${day.weekKey}`
    weeklyMinutesByEmployeeWeek[weekKey] = (weeklyMinutesByEmployeeWeek[weekKey] ?? 0) + minutes
    if ((problem.sectors?.length ?? 0) <= 1 && segments.length > 0 && day.opensAtMinutes !== null && segments[0].startMinutes === day.opensAtMinutes) {
      openingsByEmployee[employeeId] = (openingsByEmployee[employeeId] ?? 0) + 1
    }
    if (
      (problem.sectors?.length ?? 0) <= 1 &&
      segments.length > 0 &&
      day.closesAtMinutes !== null &&
      segments[segments.length - 1].endMinutes === day.closesAtMinutes
    ) {
      closingsByEmployee[employeeId] = (closingsByEmployee[employeeId] ?? 0) + 1
    }
  }

  // ── Contract: exact weekly minutes per employee ───────────────────────────
  const weekKeys = [...new Set(problem.days.map((day) => day.weekKey))].sort()
  for (const employee of problem.employees) {
    for (const weekKey of weekKeys) {
      const actual = weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`] ?? 0
      if (actual !== employee.contractMinutes) {
        add(
          "contract-minutes",
          "blocking",
          `${employee.firstName} ${employee.lastName} : ${actual} minutes planifiées sur ${weekKey} pour un contrat de ${employee.contractMinutes} minutes (écart ${signed(actual - employee.contractMinutes)}).`,
          { employeeId: employee.id, expected: employee.contractMinutes, actual }
        )
      }
    }
  }

  // ── Daily budgets ─────────────────────────────────────────────────────────
  for (const day of problem.days) {
    const actual = dailyMinutesByDate[day.date] ?? 0
    if ((day.budgetMode ?? "exact") === "exact" && actual !== day.budgetMinutes) {
      add(
        "daily-budget",
        "blocking",
        `Le ${day.date} totalise ${actual} minutes pour un budget de ${day.budgetMinutes} minutes (écart ${signed(actual - day.budgetMinutes)}).`,
        { date: day.date, expected: day.budgetMinutes, actual }
      )
    }
  }

  // ── Mandatory days, fixed rest, availability ──────────────────────────────
  for (const entry of problem.employeeDays) {
    const employee = employeeById.get(String(entry.employeeId))
    if (!employee) continue
    const key = `${String(entry.employeeId)}|${entry.date}`
    const minutes = dailyMinutesByEmployeeDate[key] ?? 0
    if (entry.mandatory && minutes === 0) {
      add("mandatory-day", "blocking", `${employee.firstName} ${employee.lastName} n'est pas planifié le ${entry.date}, qui est un jour obligatoirement travaillé.`, { employeeId: employee.id, date: entry.date })
    }
    if (entry.fixedRest && minutes > 0) {
      add("fixed-rest-day", "blocking", `${employee.firstName} ${employee.lastName} est planifié ${minutes} minutes le ${entry.date}, qui est un repos fixe.`, { employeeId: employee.id, date: entry.date, actual: minutes })
    }
    if (!entry.available && !entry.fixedRest && minutes > 0) {
      add("availability", "blocking", `${employee.firstName} ${employee.lastName} est planifié le ${entry.date} alors qu'il est indisponible (${entry.unavailableReason ?? "indisponible"}).`, { employeeId: employee.id, date: entry.date, actual: minutes })
    }
    if (entry.available && minutes > 0) {
      const segments = worked.get(key) ?? []
      const last0 = segments[segments.length - 1]
      // Les règles fixes du salarié. Une heure imposée n'est pas une borne : la
      // dépasser est une faute, mais commencer plus tard en est une aussi.
      if (segments[0] && entry.fixedStartMinutes !== null && entry.fixedStartMinutes !== undefined && segments[0].startMinutes !== entry.fixedStartMinutes) {
        add("availability", "blocking", `${employee.firstName} commence à ${clock(segments[0].startMinutes)} le ${entry.date}, alors qu'il commence toujours à ${clock(entry.fixedStartMinutes)}.`, { employeeId: employee.id, date: entry.date, expected: entry.fixedStartMinutes, actual: segments[0].startMinutes })
      }
      if (last0 && entry.fixedEndMinutes !== null && entry.fixedEndMinutes !== undefined && last0.endMinutes !== entry.fixedEndMinutes) {
        add("availability", "blocking", `${employee.firstName} termine à ${clock(last0.endMinutes)} le ${entry.date}, alors qu'il finit toujours à ${clock(entry.fixedEndMinutes)}.`, { employeeId: employee.id, date: entry.date, expected: entry.fixedEndMinutes, actual: last0.endMinutes })
      }
      if (entry.mustOpen === true && segments[0]) {
        // Le rayon dont on parle est déduit : celui que le salarié sert, et qui
        // ouvre le plus tôt ce jour-là. En mono-rayon c'est le magasin.
        const opens = openingMinutesFor(problem, employee, entry.date)
        if (opens === null || segments[0].startMinutes !== opens) {
          add("availability", "blocking", `${employee.firstName} ouvre le ${entry.date} par règle, mais commence à ${clock(segments[0].startMinutes)}${opens === null ? " alors qu'aucun de ses rayons n'ouvre ce jour-là" : ` au lieu de ${clock(opens)}`}.`, { employeeId: employee.id, date: entry.date, expected: opens ?? 0, actual: segments[0].startMinutes })
        }
      }
      if (entry.mustClose === true && last0) {
        const closes = closingMinutesFor(problem, employee, entry.date)
        if (closes === null || last0.endMinutes !== closes) {
          add("availability", "blocking", `${employee.firstName} ferme le ${entry.date} par règle, mais termine à ${clock(last0.endMinutes)}${closes === null ? " alors qu'aucun de ses rayons ne ferme ce jour-là" : ` au lieu de ${clock(closes)}`}.`, { employeeId: employee.id, date: entry.date, expected: closes ?? 0, actual: last0.endMinutes })
        }
      }
      if (segments[0] && segments[0].startMinutes < entry.earliestStartMinutes) {
        // "sa borne de début" rather than "l'ouverture": the bound is the
        // intersection of the sector's hours and the employee's own restriction,
        // and naming the wrong one sends a manager to the wrong screen.
        add("availability", "blocking", `${employee.firstName} commence à ${clock(segments[0].startMinutes)} le ${entry.date}, avant sa borne de début (${clock(entry.earliestStartMinutes)}).`, { employeeId: employee.id, date: entry.date })
      }
      const last = segments[segments.length - 1]
      if (last && last.endMinutes > entry.latestEndMinutes) {
        add("availability", "blocking", `${employee.firstName} termine à ${clock(last.endMinutes)} le ${entry.date}, après sa borne de fin (${clock(entry.latestEndMinutes)}).`, { employeeId: employee.id, date: entry.date })
      }
      if (minutes > entry.maximumMinutes) {
        add("daily-minutes", "blocking", `${employee.firstName} travaille ${minutes} minutes le ${entry.date}, au-delà de son maximum journalier de ${entry.maximumMinutes} minutes.`, { employeeId: employee.id, date: entry.date, expected: entry.maximumMinutes, actual: minutes })
      }
    }
  }

  // ── Shift shape ───────────────────────────────────────────────────────────
  for (const [key, segments] of worked) {
    const [employeeId, date] = splitKey(key)
    const employee = employeeById.get(employeeId)!
    const minutes = totalMinutes(segments)
    if (minutes === 0) continue
    for (const segment of segments) {
      const continuousMinutes = segment.endMinutes - segment.startMinutes
      if (continuousMinutes < problem.rules.minimumShiftMinutes) {
        add("minimum-shift", "blocking", `${employee.firstName} : segment continu de ${continuousMinutes} minutes le ${date}, en dessous du minimum de ${problem.rules.minimumShiftMinutes} minutes. Un changement de rayon n'est pas une coupure.`, { employeeId: employee.id, date, expected: problem.rules.minimumShiftMinutes, actual: continuousMinutes })
      }
      if (problem.rules.maximumContinuousMinutes != null && continuousMinutes > problem.rules.maximumContinuousMinutes) {
        add("maximum-shift", "blocking", `${employee.firstName} : segment continu de ${continuousMinutes} minutes le ${date}, au-delà du maximum continu de ${problem.rules.maximumContinuousMinutes} minutes.`, { employeeId: employee.id, date, expected: problem.rules.maximumContinuousMinutes, actual: continuousMinutes })
      }
    }
    if (minutes > problem.rules.maximumShiftMinutes) {
      add("maximum-shift", "blocking", `${employee.firstName} : ${minutes} minutes le ${date}, au-delà du maximum de ${problem.rules.maximumShiftMinutes} minutes.`, { employeeId: employee.id, date, expected: problem.rules.maximumShiftMinutes, actual: minutes })
    }
    if (segments.length > 1) {
      const assignment = assignmentByKey.get(key)
      const sectorIds = assignment === undefined
        ? [problem.sectorId]
        : [...new Set(normalizedSectorAssignments(problem, assignment).map((block) => block.sectorId))]
      const splitRules = sectorIds.map((sectorId) =>
        problem.sectors?.find((sector) => sector.id === sectorId)?.splitRules ?? problem.rules
      )
      if (splitRules.some((rules) => !rules.splitShiftAllowed)) {
        add("split-shift", "blocking", `${employee.firstName} : coupure le ${date} alors qu'au moins un rayon travaillé ce jour-là interdit les coupures.`, { employeeId: employee.id, date })
      } else if (!employee.canSplitShift) {
        add("split-shift", "blocking", `${employee.firstName} : coupure le ${date} sans la capacité CAN_SPLIT_SHIFT.`, { employeeId: employee.id, date })
      }
      const splitCount = segments.length - 1
      if (splitRules.some((rules) => rules.maximumSplitsPerDay != null && splitCount > rules.maximumSplitsPerDay)) {
        add("split-shift", "blocking", `${employee.firstName} : ${splitCount} coupure${splitCount > 1 ? "s" : ""} le ${date}, au-delà du maximum d'un rayon travaillé.`, { employeeId: employee.id, date })
      }
      for (let index = 1; index < segments.length; index++) {
        const gap = segments[index].startMinutes - segments[index - 1].endMinutes
        const minimum = Math.max(0, ...splitRules.map((rules) => rules.minimumSplitMinutes ?? 0))
        const finiteMaximums = splitRules.map((rules) => rules.maximumSplitMinutes).filter((value): value is number => value != null)
        const maximum = finiteMaximums.length > 0 ? Math.min(...finiteMaximums) : null
        if (gap < minimum) {
          add("split-shift", "blocking", `${employee.firstName} : coupure de ${gap} minutes le ${date}, en dessous du minimum de ${minimum} minutes.`, { employeeId: employee.id, date, expected: minimum, actual: gap })
        }
        if (maximum !== null && gap > maximum) {
          add("split-shift", "blocking", `${employee.firstName} : coupure de ${gap} minutes le ${date}, au-delà du maximum de ${maximum} minutes.`, { employeeId: employee.id, date, expected: maximum, actual: gap })
        }
      }
    }
  }

  // ── Rest between two days, consecutive days ───────────────────────────────
  const orderedDays = [...problem.days].sort((left, right) => left.date.localeCompare(right.date))
  for (const employee of problem.employees) {
    let previous: { date: IsoDate; endMinutes: number } | null = null
    let streak = 0
    for (const day of orderedDays) {
      const segments = worked.get(`${String(employee.id)}|${day.date}`) ?? []
      if (segments.length === 0) {
        previous = null
        streak = 0
        continue
      }
      streak++
      if (
        problem.rules.maximumConsecutiveWorkedDays !== null &&
        streak > problem.rules.maximumConsecutiveWorkedDays
      ) {
        add("consecutive-days", "blocking", `${employee.firstName} enchaîne ${streak} jours travaillés au ${day.date}, au-delà du maximum de ${problem.rules.maximumConsecutiveWorkedDays}.`, { employeeId: employee.id, date: day.date, expected: problem.rules.maximumConsecutiveWorkedDays, actual: streak })
      }
      if (previous) {
        const gapDays = daysBetween(previous.date, day.date)
        const rest = gapDays * 24 * 60 - previous.endMinutes + segments[0].startMinutes
        if (rest < problem.rules.minimumRestMinutes) {
          add("minimum-rest", "blocking", `${employee.firstName} : ${rest} minutes de repos entre le ${previous.date} et le ${day.date}, en dessous du minimum de ${problem.rules.minimumRestMinutes} minutes.`, { employeeId: employee.id, date: day.date, expected: problem.rules.minimumRestMinutes, actual: rest })
        }
      }
      previous = { date: day.date, endMinutes: segments[segments.length - 1].endMinutes }
    }
  }

  // ── Openings and closings ─────────────────────────────────────────────────
  for (const day of problem.days) {
    if (day.closed) continue
    if ((problem.sectors?.length ?? 0) > 1) {
      for (const sector of problem.sectors ?? []) {
        const sectorDay = sector.days.find((entry) => entry.date === day.date)
        if (!sectorDay || sectorDay.closed) continue
        const openers: PlanningEmployeeV3[] = []
        const closers: PlanningEmployeeV3[] = []
        for (const employee of problem.employees) {
          const assignment = assignmentByKey.get(`${String(employee.id)}|${day.date}`)
          if (!assignment) continue
          const blocks = normalizedSectorAssignments(problem, assignment).filter((block) => block.sectorId === sector.id)
          if (blocks.some((block) => block.startMinutes === sectorDay.opensAtMinutes)) {
            openers.push(employee)
            openingsByEmployee[String(employee.id)] = (openingsByEmployee[String(employee.id)] ?? 0) + 1
            if (!employee.canOpen) add("opening-capability", "blocking", `${employee.firstName} ouvre le rayon « ${sector.name} » le ${day.date} sans la capacité CAN_OPEN.`, { employeeId: employee.id, date: day.date })
          }
          // Un rayon peut s'attarder jusqu'à `latestCloseMinutes` : ferme celui
          // qui finit dans cette fenêtre, pas seulement à la minute nominale.
          // Jamais avant, en revanche — la couverture nominale reste due.
          const latestClose = Math.max(
            sectorDay.closesAtMinutes ?? 0,
            sectorDay.latestCloseMinutes ?? sectorDay.closesAtMinutes ?? 0
          )
          if (blocks.some((block) =>
            sectorDay.closesAtMinutes !== null
            && block.endMinutes >= sectorDay.closesAtMinutes
            && block.endMinutes <= latestClose
          )) {
            closers.push(employee)
            closingsByEmployee[String(employee.id)] = (closingsByEmployee[String(employee.id)] ?? 0) + 1
            if (!employee.canClose) add("closing-capability", "blocking", `${employee.firstName} ferme le rayon « ${sector.name} » le ${day.date} sans la capacité CAN_CLOSE.`, { employeeId: employee.id, date: day.date })
          }
        }
        // Une exigence que la DEMANDE du rayon porte déjà n'est pas comptée une
        // seconde fois. Un bloc ne peut ni commencer avant l'ouverture ni finir
        // après la fermeture élargie : couvrir la première tranche, c'est
        // ouvrir. Les compter deux fois, une fois en souple et une fois en dur,
        // transformait un petit déficit en semaine entièrement refusée.
        const impliedByDemand = roleImpliedByDemand(problem, sector.id, sectorDay)
        if (!impliedByDemand && openers.length < sectorDay.minimumOpenings) add("opening-count", "blocking", `Le ${day.date}, le rayon « ${sector.name} » compte ${openers.length} ouverture(s), minimum attendu : ${sectorDay.minimumOpenings}.`, { date: day.date, expected: sectorDay.minimumOpenings, actual: openers.length })
        if (!impliedByDemand && closers.length < sectorDay.exactClosings) add("closing-count", "blocking", `Le ${day.date}, le rayon « ${sector.name} » compte ${closers.length} fermeture(s), minimum attendu : ${sectorDay.exactClosings}.`, { date: day.date, expected: sectorDay.exactClosings, actual: closers.length })
      }
      continue
    }
    const openers: PlanningEmployeeV3[] = []
    const closers: PlanningEmployeeV3[] = []
    for (const employee of problem.employees) {
      const segments = worked.get(`${String(employee.id)}|${day.date}`) ?? []
      if (segments.length === 0) continue
      if (day.opensAtMinutes !== null && segments[0].startMinutes === day.opensAtMinutes) {
        openers.push(employee)
        if (!employee.canOpen) {
          add("opening-capability", "blocking", `${employee.firstName} ${employee.lastName} ouvre le ${day.date} sans la capacité CAN_OPEN.`, { employeeId: employee.id, date: day.date })
        }
      }
      if (
        day.closesAtMinutes !== null &&
        segments[segments.length - 1].endMinutes === day.closesAtMinutes
      ) {
        closers.push(employee)
        if (!employee.canClose) {
          add("closing-capability", "blocking", `${employee.firstName} ${employee.lastName} ferme le ${day.date} sans la capacité CAN_CLOSE.`, { employeeId: employee.id, date: day.date })
        }
      }
    }
    if (openers.length < problem.rules.minimumOpeningsPerDay) {
      add("opening-count", "blocking", `Le ${day.date} compte ${openers.length} ouverture(s) pour ${problem.rules.minimumOpeningsPerDay} attendue(s) au minimum.`, { date: day.date, expected: problem.rules.minimumOpeningsPerDay, actual: openers.length })
    }
    if (closers.length < problem.rules.exactClosingsPerDay) {
      add("closing-count", "blocking", `Le ${day.date} compte ${closers.length} fermeture(s) pour ${problem.rules.exactClosingsPerDay} attendue(s) au minimum.`, { date: day.date, expected: problem.rules.exactClosingsPerDay, actual: closers.length })
    }
  }

  for (const employee of problem.employees) {
    const openings = openingsByEmployee[String(employee.id)] ?? 0
    const closings = closingsByEmployee[String(employee.id)] ?? 0
    if (employee.maximumOpenings !== null && openings > employee.maximumOpenings) {
      add("maximum-openings", "blocking", `${employee.firstName} ${employee.lastName} assure ${openings} ouvertures pour un maximum de ${employee.maximumOpenings}.`, { employeeId: employee.id, expected: employee.maximumOpenings, actual: openings })
    }
    if (employee.maximumClosings !== null && closings > employee.maximumClosings) {
      add("maximum-closings", "blocking", `${employee.firstName} ${employee.lastName} assure ${closings} fermetures pour un maximum de ${employee.maximumClosings}.`, { employeeId: employee.id, expected: employee.maximumClosings, actual: closings })
    }
  }

  // ── Closing fairness ──────────────────────────────────────────────────────
  //
  // REPORTED, never enforced. The spread between the busiest and the quietest
  // closer is a fact about the week; whether it is acceptable is a judgement,
  // and a validator that refused a schedule over it would be turning a soft
  // objective into a hard one.
  //
  // Severity is `information` for exactly that reason: it must never make
  // `validHardConstraints` false, and it must never appear as something a human
  // has to accept before publishing.
  //
  // NOT reported through `add`, which feeds `violations` — the array whose
  // emptiness IS `validHardConstraints`. A soft objective that reached it would
  // make a perfectly legal schedule read as illegal, which is precisely the
  // confusion between "worse" and "forbidden" this validator exists to prevent.
  const fairnessInformations: PlanningViolationV3[] = []
  const fairness = problem.rules.closingFairness
  if (fairness && (fairness.balanceClosings || fairness.balanceSaturdayClosings)) {
    const history = problem.closingHistory ?? []
    const saturdays = new Set(problem.days.filter((day) => day.weekDay === "saturday").map((day) => day.date))
    // Only people who may close have a load worth measuring; someone barred
    // from closing is not "unfairly light".
    const closers = problem.employees.filter((employee) => employee.canClose)
    const closerIds = closers.map((employee) => employee.id)

    // Qui a fermé, quel jour. Calculé une fois et servant à deux comptes : les
    // fermetures du samedi, et la dépense du plafond hebdomadaire.
    const closedOn = new Set<string>()
    for (const [key, segments] of worked) {
      if (segments.length === 0) continue
      const [, date] = splitKey(key)
      const day = dayByDate.get(date)
      if (!day || day.closesAtMinutes === null) continue
      if (segments[segments.length - 1].endMinutes === day.closesAtMinutes) closedOn.add(key)
    }

    /** Saturday closings this week, per employee. */
    const addedSaturdayClosings: Record<string, number> = {}
    for (const key of closedOn) {
      const [employeeId, date] = splitKey(key)
      if (saturdays.has(date as IsoDate)) {
        addedSaturdayClosings[employeeId] = (addedSaturdayClosings[employeeId] ?? 0) + 1
      }
    }

    // La semaine en cours pèse comme les semaines passées : UNE PART PAR SEMAINE,
    // et non une occasion par jour. Les deux comptes doivent suivre la même règle
    // — l'historique et cette semaine forment un seul rapport, et les calculer
    // différemment ferait changer la charge affichée dès que cette semaine
    // deviendrait de l'historique, sans que rien n'ait bougé.
    //
    // Un seul jour possible suffit à ouvrir la semaine. Le plafond hebdomadaire
    // n'intervient plus : il borne ce qu'on peut donner, pas ce qu'on doit.
    const addedOpportunities: Record<string, number> = {}
    const addedSaturdayOpportunities: Record<string, number> = {}
    const openWeeks = new Set<string>()
    const openSaturdayWeeks = new Set<string>()
    const dayByDateLocal = new Map(problem.days.map((day) => [day.date, day]))
    for (const entry of problem.employeeDays) {
      const id = String(entry.employeeId)
      const day = dayByDateLocal.get(entry.date)
      if (!day || day.closed) continue
      const employee = employeeById.get(id)
      if (!employee?.canClose) continue
      const closed = closedOn.has(`${id}|${entry.date}`)
      if (!closed) {
        if (!entry.available) continue
        if (day.closesAtMinutes !== null && entry.latestEndMinutes < day.closesAtMinutes) continue
      }
      openWeeks.add(`${id}|${day.weekKey}`)
      if (day.weekDay === "saturday") openSaturdayWeeks.add(`${id}|${day.weekKey}`)
    }
    const addShare = (into: Record<string, number>, keys: Set<string>) => {
      for (const key of keys) {
        const id = key.slice(0, key.indexOf("|"))
        const employee = employeeById.get(id)
        if (!employee) continue
        into[id] = (into[id] ?? 0) + weeklyClosingShare(employee.workingDays.length)
      }
    }
    addShare(addedOpportunities, openWeeks)
    addShare(addedSaturdayOpportunities, openSaturdayWeeks)

    const historyById = new Map(history.map((entry) => [String(entry.employeeId), entry]))
    const before = loadsAfterWeek(history, {}, {}, closerIds)
    const after = loadsAfterWeek(history, closingsByEmployee, addedOpportunities, closerIds)
    const saturdayBefore = saturdayLoadsAfterWeek(history, {}, {}, closerIds)
    const saturdayAfter = saturdayLoadsAfterWeek(history, addedSaturdayClosings, addedSaturdayOpportunities, closerIds)

    const push = (rule: PlanningRuleCodeV3, message: string, actual: number) =>
      fairnessInformations.push({ rule, severity: "information", message, expected: 0, actual })

    // The six figures, one entry per employee plus one summary per balance, so a
    // manager can see WHY the spread is what it is and not merely that it is.
    for (const employee of closers) {
      const past = historyById.get(String(employee.id))
      const added = closingsByEmployee[String(employee.id)] ?? 0
      const load = after.find((entry) => String(entry.employeeId) === String(employee.id))!
      const saturdayLoad = saturdayAfter.find((entry) => String(entry.employeeId) === String(employee.id))!
      push(
        "closing-fairness",
        `${employee.firstName} ${employee.lastName} : ${past?.closings ?? 0} fermetures sur ${past?.opportunities ?? 0} occasions dans l'historique, ${added} ajoutée(s) cette semaine — charge finale ${permille(load)} ‰, samedi ${permille(saturdayLoad)} ‰.`,
        added
      )
    }
    // LE DÉTAIL PAR JOUR : qui a fermé, qui pouvait, et pourquoi les autres non.
    //
    // Les lignes ci-dessus disent QUE la répartition est celle-là ; elles ne
    // disent jamais POURQUOI. Un gérant qui voit le plus léger de son équipe ne
    // rien recevoir ne peut pas distinguer une contrainte réelle d'un défaut du
    // moteur — et cette question-là ne se tranche sur aucune donnée d'exemple,
    // seulement sur la sienne.
    //
    // La raison donnée est la PREMIÈRE qui s'applique, dans l'ordre où on la
    // corrigerait : une compétence manquante se règle sur la fiche, un repos
    // fixe dans les contraintes, une heure de fin dans les préférences. Les
    // empiler toutes noierait celle sur laquelle agir.
    const dayEntryByKey = new Map<string, (typeof problem.employeeDays)[number]>()
    for (const entry of problem.employeeDays) {
      dayEntryByKey.set(`${String(entry.employeeId)}|${entry.date}`, entry)
    }

    for (const day of [...problem.days].sort((left, right) => left.date.localeCompare(right.date))) {
      if (day.closed || day.closesAtMinutes === null) continue
      const took: string[] = []
      const could: string[] = []
      const blocked: string[] = []

      for (const employee of problem.employees) {
        const id = String(employee.id)
        const name = `${employee.firstName} ${employee.lastName}`
        if (closedOn.has(`${id}|${day.date}`)) {
          took.push(name)
          continue
        }
        const reason = whyNotClosing(
          employee,
          dayEntryByKey.get(`${id}|${day.date}`),
          day.closesAtMinutes,
          closingsByEmployee[id] ?? 0
        )
        if (reason === null) could.push(name)
        else blocked.push(`${name} (${reason})`)
      }

      const sentences = [
        `${WEEK_DAY_LABELS[day.weekDay]} ${day.date} — ${
          took.length > 0 ? `fermeture par ${took.join(", ")}` : "personne ne ferme"
        }.`,
      ]
      // « Pouvaient aussi » est la ligne qui compte : elle seule dit si le
      // moteur avait le choix. Vide, la répartition était forcée.
      sentences.push(
        could.length > 0 ? `Pouvaient aussi : ${could.join(", ")}.` : "Personne d'autre ne pouvait fermer."
      )
      if (blocked.length > 0) sentences.push(`Empêchés : ${blocked.join(", ")}.`)
      push("closing-fairness-day", sentences.join(" "), took.length)
    }

    if (fairness.balanceClosings) {
      push(
        "closing-fairness",
        `Écart d'équité générale : ${closingLoadSpreadPermille(before)} ‰ avant génération, ${closingLoadSpreadPermille(after)} ‰ après.`,
        closingLoadSpreadPermille(after)
      )
    }
    if (fairness.balanceSaturdayClosings) {
      push(
        "saturday-closing-fairness",
        `Écart d'équité du samedi : ${closingLoadSpreadPermille(saturdayBefore)} ‰ avant génération, ${closingLoadSpreadPermille(saturdayAfter)} ‰ après.`,
        closingLoadSpreadPermille(saturdayAfter)
      )
    }
  }

  // ── Coverage ──────────────────────────────────────────────────────────────
  //
  // Coverage is a CONCURRENCY question, not a per-shift containment one: what
  // matters is how many people are on the floor at the thinnest moment of the
  // window, not whether any single shift spans the window alone. Two or three
  // staggered shifts routinely keep the floor staffed throughout an hour
  // without any of them individually covering it — see `atomicCoverage` for
  // the worked example this fixed. `missing` is summed per ATOMIC piece too,
  // so a window short for 15 of its 60 minutes costs 15 minutes, not 60.
  let totalDeficitMinutes = 0
  let requiredMinutes = 0
  let underCoveredSlots = 0
  const coverageDegradations: PlanningViolationV3[] = []
  for (const slot of problem.demandSlots) {
    const span = slot.endMinutes - slot.startMinutes
    requiredMinutes += slot.requiredEmployees * span
    const window = { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes }
    const sectorId = slot.sectorId ?? problem.sectorId
    const intervals = problem.employees.flatMap((employee) => {
      const key = `${String(employee.id)}|${slot.date}`
      const assignment = assignmentByKey.get(key)
      if (!assignment) return []
      return normalizedSectorAssignments(problem, assignment)
        .filter((block) => block.sectorId === sectorId)
        .map((block) => ({ startMinutes: block.startMinutes, endMinutes: block.endMinutes }))
    })
    const covered = minimumConcurrentPresence(window, intervals)
    const missing = coverageDeficitMinutes(window, intervals, slot.requiredEmployees)

    // ── The operational floor, when the problem declares one ────────────────
    //
    // Checked BEFORE the soft target and reported separately. `covered` is the
    // worst concurrent presence anywhere in the window — the atomic minimum,
    // not an average and not a per-shift containment test — so a window staffed
    // throughout except for one 15-minute hole fails here, which is exactly the
    // intent: "at least one person present continuously" is either true at
    // every instant or it is false.
    //
    // Absent means NO floor was declared. It never means zero and never
    // borrows `requiredEmployees`: a problem built before this field existed
    // must validate exactly as it did before.
    if (slot.hardMinimumEmployees !== undefined && covered < slot.hardMinimumEmployees) {
      add(
        "hard-coverage-floor",
        "blocking",
        `Le ${slot.date} de ${clock(slot.startMinutes)} à ${clock(slot.endMinutes)} : ${covered} salarié(s) présent(s) pour un plancher incassable de ${slot.hardMinimumEmployees}.`,
        { date: slot.date, expected: slot.hardMinimumEmployees, actual: covered }
      )
    }

    if (covered < slot.requiredEmployees) {
      totalDeficitMinutes += missing
      underCoveredSlots++
      // A coverage shortfall is a DEGRADATION, never a blocking violation.
      // Contracted minutes are finite: when the demand exceeds what the
      // contracts can cover, every possible schedule is short somewhere. Making
      // that blocking would mean no schedule is ever publishable — Sprint 3D.1
      // itself runs with four under-covered slots. The shortfall is real and
      // must be seen, so it is surfaced as a degradation requiring an explicit
      // acceptance before publication.
      coverageDegradations.push({
        rule: "coverage-deficit",
        severity: "degradation",
        requiresExplicitAcceptance: true,
        message: `Le ${slot.date} de ${clock(slot.startMinutes)} à ${clock(slot.endMinutes)} : ${covered} salarié(s) présent(s) pour ${slot.requiredEmployees} requis (déficit ${missing} minutes).`,
        date: slot.date,
        expected: slot.requiredEmployees,
        actual: covered,
      })
    }
  }

  const totalWorkedMinutes = Object.values(dailyMinutesByDate).reduce((sum, value) => sum + value, 0)
  const totalSurplusMinutes = totalWorkedMinutes - (requiredMinutes - totalDeficitMinutes)
  const structuralSurplusMinutes = structuralSurplusOf(problem)
  const avoidableSurplusMinutes = totalSurplusMinutes - structuralSurplusMinutes

  // ── Cross-check the figures the solver committed to ───────────────────────
  const declared = solution.declaredMetrics
  const crossCheck = (
    label: string,
    declaredValue: number | undefined,
    recomputed: number
  ) => {
    if (declaredValue === undefined || declaredValue === recomputed) return
    add(
      "declared-metrics",
      "blocking",
      `Le générateur annonce ${declaredValue} minutes de ${label}, le validateur en recalcule ${recomputed}.`,
      { expected: recomputed, actual: declaredValue }
    )
  }
  crossCheck("surplus structurel", declared?.structuralSurplusMinutes, structuralSurplusMinutes)
  crossCheck("surplus évitable", declared?.avoidableSurplusMinutes, avoidableSurplusMinutes)
  crossCheck("déficit total", declared?.totalDeficitMinutes, totalDeficitMinutes)

  if (solution.problemFingerprint && solution.problemFingerprint !== fingerprintProblem(problem)) {
    add("solution-integrity", "blocking", "La solution ne référence pas l'empreinte du problème validé.")
  }

  // ── Degradations and information ──────────────────────────────────────────
  const degradations: PlanningViolationV3[] = [...coverageDegradations]
  if (avoidableSurplusMinutes > 0) {
    degradations.push({
      rule: "avoidable-surplus",
      severity: "degradation",
      requiresExplicitAcceptance: true,
      message: `${avoidableSurplusMinutes} minutes de surplus évitable : des heures sont posées hors besoin sans y être contraintes par le contrat.`,
      expected: 0,
      actual: avoidableSurplusMinutes,
    })
  }
  const informations: PlanningViolationV3[] = [
    {
      rule: "declared-metrics",
      severity: "information",
      message: `Surplus structurel ${structuralSurplusMinutes} minutes : écart incompressible entre ${totalContractMinutes(problem)} minutes contractuelles et ${requiredMinutes} minutes de besoin.`,
      actual: structuralSurplusMinutes,
    },
    ...fairnessInformations,
  ]

  const metrics: PlanningMetricsV3 = {
    weeklyMinutesByEmployeeWeek,
    dailyMinutesByEmployeeDate,
    dailyMinutesByDate,
    openingsByEmployee,
    closingsByEmployee,
    totalDeficitMinutes,
    totalSurplusMinutes,
    structuralSurplusMinutes,
    avoidableSurplusMinutes,
  }

  return {
    version: PLANNING_VALIDATION_V3_VERSION,
    validHardConstraints: violations.length === 0,
    // Only entries that ASK for a decision gate publication. Counting every
    // degradation would mean a future informative one silently starts blocking.
    requiresExplicitAcceptance: [...violations, ...degradations, ...informations].some(
      (entry) => entry.requiresExplicitAcceptance === true
    ),
    underCoveredSlots,
    violations,
    degradations,
    informations,
    metrics,
    // V3A runs no global solver, so nothing about this solution is proven.
    // Only a completed solver returning an optimality certificate may ever
    // raise this to "optimal".
    proof: {
      kind: "none",
      objectiveValues: [],
      note: "Aucun solveur global n'a tourné : aucune optimalité n'est démontrée.",
    },
    fingerprint: fingerprintSolution(solution),
  }
}

/**
 * The share of the surplus that no schedule can remove, because the contracted
 * minutes of a day exceed the minutes that day actually demands.
 *
 * Depends on the PROBLEM only — a solver cannot lower it, and a validator can
 * therefore use it as a fixed reference to separate unavoidable surplus from
 * surplus a better schedule would have avoided.
 */
export function structuralSurplusOf(problem: PlanningProblemV3): number {
  let total = 0
  for (const day of problem.days) {
    total += Math.max(0, day.budgetMinutes - demandedMinutesOn(problem, day))
  }
  return total
}

/** Employee-minutes the demand slots require on one day. */
export function demandedMinutesOn(problem: PlanningProblemV3, day: PlanningDayV3): number {
  return problem.demandSlots
    .filter((slot) => slot.date === day.date)
    .reduce((sum, slot) => sum + slot.requiredEmployees * (slot.endMinutes - slot.startMinutes), 0)
}

/**
 * La demande de ce rayon impose-t-elle déjà son ouverture et sa fermeture ?
 *
 * Miroir exact de `role_implied_by_demand` côté moteur : les deux doivent
 * répondre la même chose, sans quoi le validateur refuserait précisément les
 * plannings que le placement a le droit de produire.
 *
 * Un bloc de rayon ne peut ni commencer avant l'ouverture ni finir après la
 * fermeture élargie. Si la demande réclame au moins une personne en continu sur
 * toute la plage, alors couvrir la première tranche c'est ouvrir et couvrir la
 * dernière c'est fermer : `minimumOpenings` et `exactClosings` ne disent rien de
 * plus, et les imposer EN DUR sur une demande SOUPLE fait d'un déficit de
 * quelques minutes une semaine entièrement refusée.
 */
function roleImpliedByDemand(
  problem: PlanningProblemV3,
  sectorId: string,
  sectorDay: { readonly date: IsoDate; readonly opensAtMinutes: number | null; readonly closesAtMinutes: number | null }
): boolean {
  const { opensAtMinutes, closesAtMinutes } = sectorDay
  if (opensAtMinutes === null || closesAtMinutes === null) return false
  const covered = problem.demandSlots
    .filter(
      (slot) =>
        (slot.sectorId ?? problem.sectorId) === sectorId
        && slot.date === sectorDay.date
        && slot.requiredEmployees >= 1
    )
    .map((slot) => [slot.startMinutes, slot.endMinutes] as const)
    .sort((left, right) => left[0] - right[0])
  if (covered.length === 0) return false
  let reach = opensAtMinutes
  for (const [start, end] of covered) {
    if (start > reach) return false
    reach = Math.max(reach, end)
  }
  return reach >= closesAtMinutes
}

function totalContractMinutes(problem: PlanningProblemV3): number {
  return problem.employees.reduce((sum, employee) => sum + employee.contractMinutes, 0)
}

function sortSegments(segments: readonly PlanningSegmentV3[]): PlanningSegmentV3[] {
  return [...segments].sort((left, right) => left.startMinutes - right.startMinutes)
}

function totalMinutes(segments: readonly PlanningSegmentV3[]): number {
  return segments.reduce((sum, segment) => sum + (segment.endMinutes - segment.startMinutes), 0)
}

function splitKey(key: string): [string, IsoDate] {
  const index = key.indexOf("|")
  return [key.slice(0, index), key.slice(index + 1)]
}

/**
 * L'heure à laquelle « ouvrir » veut dire quelque chose pour ce salarié ce
 * jour-là : la plus tôt parmi les rayons qu'il est autorisé à servir, ou
 * l'ouverture du magasin quand le problème n'a pas de rayons. `null` si aucun
 * de ses rayons n'est ouvert — auquel cas la règle ne peut pas être honorée.
 */
function openingMinutesFor(
  problem: PlanningProblemV3,
  employee: PlanningEmployeeV3,
  date: IsoDate
): number | null {
  return sectorBoundFor(problem, employee, date, "opensAtMinutes", Math.min)
}

/** Le pendant de `openingMinutesFor` : la fermeture la plus tardive. */
function closingMinutesFor(
  problem: PlanningProblemV3,
  employee: PlanningEmployeeV3,
  date: IsoDate
): number | null {
  return sectorBoundFor(problem, employee, date, "closesAtMinutes", Math.max)
}

function sectorBoundFor(
  problem: PlanningProblemV3,
  employee: PlanningEmployeeV3,
  date: IsoDate,
  field: "opensAtMinutes" | "closesAtMinutes",
  pick: (...values: number[]) => number
): number | null {
  const sectors = problem.sectors ?? []
  if (sectors.length === 0) {
    const day = problem.days.find((item) => item.date === date)
    if (!day || day.closed) return null
    return day[field] ?? null
  }
  const allowed = new Set((employee.allowedSectorIds ?? []).map(String))
  const bounds: number[] = []
  for (const sector of sectors) {
    if (allowed.size > 0 && !allowed.has(String(sector.id))) continue
    for (const day of sector.days) {
      if (day.date !== date || day.closed) continue
      const value = day[field]
      if (typeof value === "number") bounds.push(value)
    }
  }
  return bounds.length === 0 ? null : pick(...bounds)
}

function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = Date.UTC(...parts(from))
  const end = Date.UTC(...parts(to))
  return Math.round((end - start) / 86_400_000)
}

function parts(date: IsoDate): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number)
  return [year, month - 1, day]
}

/**
 * Pourquoi cette personne n'a pas pu fermer ce jour-là, ou `null` si elle le
 * pouvait. La première raison qui s'applique, dans l'ordre où on la corrigerait.
 */
function whyNotClosing(
  employee: { readonly canClose: boolean; readonly maximumClosings: number | null },
  entry: { readonly available: boolean; readonly fixedRest: boolean; readonly latestEndMinutes: number } | undefined,
  closesAtMinutes: number,
  closingsThisWeek: number
): string | null {
  if (!employee.canClose) return "pas la compétence fermeture"
  if (!entry) return "hors du planning ce jour-là"
  if (entry.fixedRest) return "repos fixe"
  if (!entry.available) return "indisponible"
  if (entry.latestEndMinutes < closesAtMinutes) return `doit partir avant ${clock(closesAtMinutes)}`
  if (employee.maximumClosings !== null && closingsThisWeek >= employee.maximumClosings) {
    // Le plafond est HEBDOMADAIRE : dire « déjà atteint » un lundi laisserait
    // croire qu'il bloquait ce jour-là, alors que les fermetures peuvent avoir
    // été prises le vendredi. Ce qui est vrai, et utile, c'est que son quota de
    // la semaine est entièrement engagé ailleurs.
    return `plafond hebdomadaire de ${employee.maximumClosings} atteint, ${closingsThisWeek} prise${closingsThisWeek > 1 ? "s" : ""} d'autres jours`
  }
  return null
}

const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

function format(segment: PlanningSegmentV3): string {
  return `${clock(segment.startMinutes)}–${clock(segment.endMinutes)}`
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/** A load as an integer permille, for display. Zero opportunities reads as 0. */
function permille(load: ClosingLoad): number {
  return load.opportunities > 0 ? Math.round((load.closings * 1000) / load.opportunities) : 0
}
