import type { IsoDate } from "@/features/core/models"
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
  fingerprintProblem,
  fingerprintSolution,
} from "@/features/core/planning-v3/validator/fingerprint"

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
  const employeeDayByKey = new Map(
    problem.employeeDays.map((entry) => [`${String(entry.employeeId)}|${entry.date}`, entry])
  )

  // ── Structural integrity of the submitted solution ────────────────────────
  const worked = new Map<string, PlanningSegmentV3[]>()
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
    if (segments.length > 0 && day.opensAtMinutes !== null && segments[0].startMinutes === day.opensAtMinutes) {
      openingsByEmployee[employeeId] = (openingsByEmployee[employeeId] ?? 0) + 1
    }
    if (
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
    if (actual !== day.budgetMinutes) {
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
      if (segments[0] && segments[0].startMinutes < entry.earliestStartMinutes) {
        add("availability", "blocking", `${employee.firstName} commence à ${clock(segments[0].startMinutes)} le ${entry.date}, avant l'ouverture (${clock(entry.earliestStartMinutes)}).`, { employeeId: employee.id, date: entry.date })
      }
      const last = segments[segments.length - 1]
      if (last && last.endMinutes > entry.latestEndMinutes) {
        add("availability", "blocking", `${employee.firstName} termine à ${clock(last.endMinutes)} le ${entry.date}, après la fermeture (${clock(entry.latestEndMinutes)}).`, { employeeId: employee.id, date: entry.date })
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
    if (minutes < problem.rules.minimumShiftMinutes) {
      add("minimum-shift", "blocking", `${employee.firstName} : ${minutes} minutes le ${date}, en dessous du minimum de ${problem.rules.minimumShiftMinutes} minutes.`, { employeeId: employee.id, date, expected: problem.rules.minimumShiftMinutes, actual: minutes })
    }
    if (minutes > problem.rules.maximumShiftMinutes) {
      add("maximum-shift", "blocking", `${employee.firstName} : ${minutes} minutes le ${date}, au-delà du maximum de ${problem.rules.maximumShiftMinutes} minutes.`, { employeeId: employee.id, date, expected: problem.rules.maximumShiftMinutes, actual: minutes })
    }
    if (segments.length > 1) {
      if (!problem.rules.splitShiftAllowed) {
        add("split-shift", "blocking", `${employee.firstName} : coupure le ${date} alors que les coupures sont interdites.`, { employeeId: employee.id, date })
      } else if (!employee.canSplitShift) {
        add("split-shift", "blocking", `${employee.firstName} : coupure le ${date} sans la capacité CAN_SPLIT_SHIFT.`, { employeeId: employee.id, date })
      }
      for (let index = 1; index < segments.length; index++) {
        const gap = segments[index].startMinutes - segments[index - 1].endMinutes
        if (problem.rules.maximumSplitMinutes !== null && gap > problem.rules.maximumSplitMinutes) {
          add("split-shift", "blocking", `${employee.firstName} : coupure de ${gap} minutes le ${date}, au-delà du maximum de ${problem.rules.maximumSplitMinutes} minutes.`, { employeeId: employee.id, date, expected: problem.rules.maximumSplitMinutes, actual: gap })
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
    if (closers.length !== problem.rules.exactClosingsPerDay) {
      add("closing-count", "blocking", `Le ${day.date} compte ${closers.length} fermeture(s) pour ${problem.rules.exactClosingsPerDay} attendue(s).`, { date: day.date, expected: problem.rules.exactClosingsPerDay, actual: closers.length })
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
    const intervals = problem.employees.flatMap((employee) =>
      worked.get(`${String(employee.id)}|${slot.date}`) ?? []
    )
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

function daysBetween(from: IsoDate, to: IsoDate): number {
  const start = Date.UTC(...parts(from))
  const end = Date.UTC(...parts(to))
  return Math.round((end - start) / 86_400_000)
}

function parts(date: IsoDate): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number)
  return [year, month - 1, day]
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
