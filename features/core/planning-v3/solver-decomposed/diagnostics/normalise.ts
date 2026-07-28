import type { EmployeeId, IsoDate } from "@/features/core/models"

import type {
  PlanningDayV3,
  PlanningDemandSlotV3,
  PlanningEmployeeDayV3,
  PlanningEmployeeV3,
  PlanningProblemV3,
} from "@/features/core/planning-v3/types/problem"
import { PLANNING_PROBLEM_V3_VERSION } from "@/features/core/planning-v3/types/problem"
import type { PlanningInfeasibilityV3 } from "@/features/core/planning-v3/types/validation"

import type {
  DecomposedResolvedOptions,
  EffectiveRules,
} from "@/features/core/planning-v3/solver-decomposed/types"

/**
 * Phase 1 — normalisation, then the structural questions that can be answered
 * BEFORE any search.
 *
 * Two jobs, deliberately in this order.
 *
 * Normalisation puts the problem into a shape every later phase can index by
 * position instead of searching by id: employees and days sorted by a total,
 * value-based order, and the availability matrix materialised. Determinism
 * starts here — every downstream loop walks these arrays, so no phase can
 * accidentally depend on the order the caller happened to build its input in.
 *
 * The diagnostics answer "can this possibly have a solution", using necessary
 * conditions only. Every check below is a THEOREM about the problem, never a
 * heuristic: if it fires, no schedule exists, and the engine may say
 * `infeasible` honestly rather than searching until a clock runs out. A
 * condition that merely makes a problem hard does NOT belong here.
 *
 * The distinction the brief insists on is enforced throughout: an impossibility
 * is never converted into an accepted deficit. A hard floor that cannot be
 * staffed is reported here and stops the pipeline; it does not become a
 * coverage degradation someone is asked to accept.
 */

export interface NormalisedProblem {
  readonly problem: PlanningProblemV3
  readonly employees: readonly PlanningEmployeeV3[]
  readonly days: readonly PlanningDayV3[]
  /** `entries[employeeIndex][dayIndex]`, always present, never undefined. */
  readonly entries: readonly (readonly PlanningEmployeeDayV3[])[]
  /** Demand slots grouped by day index, sorted by start then id. */
  readonly slotsByDay: readonly (readonly PlanningDemandSlotV3[])[]
  /** `capacity[employeeIndex][dayIndex]`: the most minutes that cell may hold. */
  readonly capacity: readonly (readonly number[])[]
  readonly rules: EffectiveRules
  readonly employeeIndexById: ReadonlyMap<string, number>
  readonly dayIndexByDate: ReadonlyMap<string, number>
}

export interface NormalisationResult {
  readonly normalised: NormalisedProblem
  /** Reasons the problem is malformed. Non-empty means `invalid-problem`. */
  readonly malformed: readonly PlanningInfeasibilityV3[]
  /** Proven impossibilities. Non-empty means `infeasible`. */
  readonly structural: readonly PlanningInfeasibilityV3[]
}

export function normaliseProblem(
  problem: PlanningProblemV3,
  options: DecomposedResolvedOptions
): NormalisationResult {
  const malformed = checkShape(problem)

  // Total, value-based orders. `localeCompare` on the branded id rather than
  // the input order: two callers that build the same problem from different
  // sources must get byte-identical schedules out.
  const employees = [...problem.employees].sort((left, right) =>
    String(left.id).localeCompare(String(right.id))
  )
  const days = [...problem.days].sort((left, right) => left.date.localeCompare(right.date))

  const employeeIndexById = new Map(employees.map((employee, index) => [String(employee.id), index]))
  const dayIndexByDate = new Map(days.map((day, index) => [day.date, index]))

  const entryByKey = new Map(
    problem.employeeDays.map((entry) => [`${String(entry.employeeId)}|${entry.date}`, entry])
  )
  const entries = employees.map((employee) =>
    days.map((day) => entryByKey.get(`${String(employee.id)}|${day.date}`) ?? absent(employee.id, day))
  )

  const slotsByDay = days.map((day) =>
    problem.demandSlots
      .filter((slot) => slot.date === day.date)
      .sort(
        (left, right) =>
          left.startMinutes - right.startMinutes ||
          left.endMinutes - right.endMinutes ||
          left.id.localeCompare(right.id)
      )
  )

  const rules = effectiveRulesOf(problem, options)

  const capacity = employees.map((employee, employeeIndex) =>
    days.map((day, dayIndex) => {
      const entry = entries[employeeIndex][dayIndex]
      if (!entry.available || day.closed) return 0
      return dailyCeiling(employee, entry.latestEndMinutes - entry.earliestStartMinutes, rules)
    })
  )

  const normalised: NormalisedProblem = {
    problem,
    employees,
    days,
    entries,
    slotsByDay,
    capacity,
    rules,
    employeeIndexById,
    dayIndexByDate,
  }

  // A malformed problem was never a problem; proving things about it would be
  // proving things about nothing.
  const structural = malformed.length > 0 ? [] : diagnoseStructure(normalised)

  return { normalised, malformed, structural }
}

/** The rules the engine will actually search under, with assumptions recorded. */
export function effectiveRulesOf(
  problem: PlanningProblemV3,
  options: DecomposedResolvedOptions
): EffectiveRules {
  const assumed: string[] = []
  const rules = problem.rules

  let minimumSplitMinutes = rules.minimumSplitMinutes ?? null
  if (minimumSplitMinutes === null || minimumSplitMinutes === undefined) {
    minimumSplitMinutes = options.assumedMinimumSplitMinutes
    if (rules.splitShiftAllowed) assumed.push("minimumSplitMinutes")
  }

  // No configuration caps an uninterrupted stretch yet. Defaulting it to the
  // daily maximum is the ONLY neutral choice: any smaller number would forbid
  // schedules the problem permits, and forbidding is not this engine's call.
  let maximumContinuousMinutes = rules.maximumContinuousMinutes ?? null
  if (maximumContinuousMinutes === null || maximumContinuousMinutes === undefined) {
    maximumContinuousMinutes = rules.maximumShiftMinutes
    assumed.push("maximumContinuousMinutes")
  }

  let maximumSplitsPerDay = rules.maximumSplitsPerDay ?? null
  if (maximumSplitsPerDay === null || maximumSplitsPerDay === undefined) {
    maximumSplitsPerDay = 1
    if (rules.splitShiftAllowed) assumed.push("maximumSplitsPerDay")
  }

  return {
    timeStepMinutes: problem.timeStepMinutes,
    minimumShiftMinutes: rules.minimumShiftMinutes,
    maximumShiftMinutes: rules.maximumShiftMinutes,
    minimumRestMinutes: rules.minimumRestMinutes,
    splitShiftAllowed: rules.splitShiftAllowed,
    minimumSplitMinutes,
    maximumSplitMinutes: rules.maximumSplitMinutes ?? 0,
    maximumContinuousMinutes,
    maximumSplitsPerDay,
    minimumOpeningsPerDay: rules.minimumOpeningsPerDay,
    exactClosingsPerDay: rules.exactClosingsPerDay,
    assumed,
  }
}

function checkShape(problem: PlanningProblemV3): PlanningInfeasibilityV3[] {
  const errors: PlanningInfeasibilityV3[] = []
  if (problem.version !== PLANNING_PROBLEM_V3_VERSION) {
    errors.push({
      code: "unsupported_problem_version",
      message: `Version de problème ${problem.version} non prise en charge (${PLANNING_PROBLEM_V3_VERSION} attendue).`,
    })
  }
  if (problem.employees.length === 0) {
    errors.push({ code: "no_employee", message: "Le problème ne contient aucun salarié." })
  }
  if (problem.days.length === 0) {
    errors.push({ code: "no_day", message: "Le problème ne contient aucun jour." })
  }
  if (problem.timeStepMinutes <= 0) {
    errors.push({ code: "invalid_time_step", message: "Le pas de temps doit être positif." })
  }
  if (problem.rules.minimumShiftMinutes > problem.rules.maximumShiftMinutes) {
    errors.push({
      code: "inverted_shift_bounds",
      message: `Durée minimale ${problem.rules.minimumShiftMinutes} supérieure à la durée maximale ${problem.rules.maximumShiftMinutes}.`,
    })
  }

  const step = problem.timeStepMinutes
  if (step > 0) {
    for (const employee of problem.employees) {
      if (employee.contractMinutes % step !== 0) {
        errors.push({
          code: "contract_off_step",
          employeeId: employee.id,
          message: `Le contrat de ${employee.firstName} (${employee.contractMinutes} min) n'est pas un multiple du pas de ${step} minutes.`,
        })
      }
    }
    for (const day of problem.days) {
      if (day.budgetMinutes % step !== 0) {
        errors.push({
          code: "budget_off_step",
          date: day.date,
          message: `Le budget du ${day.date} (${day.budgetMinutes} min) n'est pas un multiple du pas de ${step} minutes.`,
        })
      }
      if (day.closed && day.budgetMinutes > 0) {
        errors.push({
          code: "closed_day_with_budget",
          date: day.date,
          message: `Le ${day.date} est fermé mais porte un budget de ${day.budgetMinutes} minutes.`,
        })
      }
    }
  }

  for (const slot of problem.demandSlots) {
    if (slot.hardMinimumEmployees !== undefined && slot.hardMinimumEmployees < 0) {
      errors.push({
        code: "negative_hard_minimum",
        date: slot.date,
        message: `Le créneau ${slot.id} déclare un plancher négatif (${slot.hardMinimumEmployees}).`,
      })
    }
    // This engine measures coverage on a grid whose cell is the time step. The
    // grid is EXACT — equal to true atomic coverage — precisely and only while
    // every boundary lands on a step multiple, because then no presence change
    // can happen strictly inside a cell.
    //
    // A slot that breaks the alignment is REFUSED rather than rounded. Rounding
    // outward would invent coverage the schedule does not have and rounding
    // inward would hide a real hole; either way the engine would be answering a
    // different question than the validator will ask. Refusing is the only
    // reading compatible with "no silent fallback".
    if (step > 0 && (slot.startMinutes % step !== 0 || slot.endMinutes % step !== 0)) {
      errors.push({
        code: "slot_off_step",
        date: slot.date,
        message: `Le créneau ${slot.id} (${slot.startMinutes}–${slot.endMinutes}) n'est pas aligné sur le pas de ${step} minutes : ce moteur ne peut pas en mesurer la couverture exactement.`,
      })
    }
  }

  return errors
}

/**
 * The necessary conditions.
 *
 * Each one is a counting argument: it compares what the problem DEMANDS with
 * what it can possibly SUPPLY, using only upper bounds on supply. A violated
 * bound cannot be repaired by any placement, so reporting `infeasible` is
 * sound. Nothing heuristic is allowed in this function.
 */
function diagnoseStructure(normalised: NormalisedProblem): PlanningInfeasibilityV3[] {
  const found: PlanningInfeasibilityV3[] = []
  const { employees, days, entries, capacity, slotsByDay, rules } = normalised

  // ── The books must balance ────────────────────────────────────────────────
  //
  // Daily budgets are EXACT in this model, not ceilings: the validator checks
  // the worked minutes of a day against its budget. So the contracted minutes
  // and the budgeted minutes are the same quantity counted twice, and a
  // mismatch means no schedule can satisfy both.
  const totalContract = employees.reduce((sum, employee) => sum + employee.contractMinutes, 0)
  const totalBudget = days.reduce((sum, day) => sum + day.budgetMinutes, 0)
  if (totalContract !== totalBudget) {
    found.push({
      code: "contract_budget_mismatch",
      message: `Les contrats totalisent ${totalContract} minutes et les budgets journaliers ${totalBudget} : aucun planning ne peut satisfaire les deux exactement.`,
    })
  }

  // ── Every employee must be able to place their contract ───────────────────
  for (let employeeIndex = 0; employeeIndex < employees.length; employeeIndex++) {
    const employee = employees[employeeIndex]
    if (employee.contractMinutes === 0) continue

    const ceiling = capacity[employeeIndex].reduce((sum, value) => sum + value, 0)
    if (ceiling < employee.contractMinutes) {
      found.push({
        code: "contract_exceeds_capacity",
        employeeId: employee.id,
        message: `${employee.firstName} doit ${employee.contractMinutes} minutes mais ses jours disponibles n'en offrent au plus que ${ceiling}.`,
      })
      continue
    }

    // A worked day cannot be shorter than the minimum shift, so the contract
    // must be reachable as a sum of at most `availableDays` terms each at least
    // `minimumShiftMinutes` — i.e. it cannot be a non-zero amount below one
    // whole minimum shift.
    const availableDays = capacity[employeeIndex].filter((value) => value > 0).length
    if (availableDays === 0) {
      found.push({
        code: "contract_without_available_day",
        employeeId: employee.id,
        message: `${employee.firstName} doit ${employee.contractMinutes} minutes mais n'a aucun jour disponible.`,
      })
    } else if (employee.contractMinutes < rules.minimumShiftMinutes) {
      found.push({
        code: "contract_below_minimum_shift",
        employeeId: employee.id,
        message: `${employee.firstName} doit ${employee.contractMinutes} minutes, moins qu'un shift minimal de ${rules.minimumShiftMinutes} minutes.`,
      })
    }
  }

  // ── Every day must be able to absorb its budget ───────────────────────────
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const day = days[dayIndex]
    if (day.budgetMinutes === 0) continue

    const ceiling = employees.reduce((sum, _employee, employeeIndex) => sum + capacity[employeeIndex][dayIndex], 0)
    if (ceiling < day.budgetMinutes) {
      found.push({
        code: "budget_exceeds_daily_capacity",
        date: day.date,
        message: `Le ${day.date} demande ${day.budgetMinutes} minutes mais les salariés disponibles n'en offrent au plus que ${ceiling}.`,
      })
    }
  }

  // ── Opening and closing must be staffable ─────────────────────────────────
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const day = days[dayIndex]
    if (day.closed) continue

    const openers = employees.filter(
      (employee, employeeIndex) =>
        employee.canOpen &&
        capacity[employeeIndex][dayIndex] > 0 &&
        entries[employeeIndex][dayIndex].earliestStartMinutes <= (day.opensAtMinutes ?? 0)
    ).length
    if (openers < rules.minimumOpeningsPerDay) {
      found.push({
        code: "no_capable_opener",
        date: day.date,
        message: `Le ${day.date} exige ${rules.minimumOpeningsPerDay} ouverture(s) mais seuls ${openers} salarié(s) peuvent ouvrir ce jour-là.`,
      })
    }

    const closers = employees.filter(
      (employee, employeeIndex) =>
        employee.canClose &&
        capacity[employeeIndex][dayIndex] > 0 &&
        entries[employeeIndex][dayIndex].latestEndMinutes >= (day.closesAtMinutes ?? 0)
    ).length
    if (closers < rules.exactClosingsPerDay) {
      found.push({
        code: "no_capable_closer",
        date: day.date,
        message: `Le ${day.date} exige ${rules.exactClosingsPerDay} fermeture(s) mais seuls ${closers} salarié(s) peuvent fermer ce jour-là.`,
      })
    }
  }

  // ── The hard floors must be reachable ─────────────────────────────────────
  //
  // Counted against the people who could be PRESENT during the window at all,
  // which is an upper bound on the people who will be. A floor above it is
  // unreachable by any schedule — and must never be softened into a deficit.
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    for (const slot of slotsByDay[dayIndex]) {
      const floor = slot.hardMinimumEmployees
      if (floor === undefined || floor === 0) continue

      const eligible = employees.filter((_employee, employeeIndex) => {
        const entry = entries[employeeIndex][dayIndex]
        if (capacity[employeeIndex][dayIndex] <= 0) return false
        return (
          entry.earliestStartMinutes <= slot.startMinutes && entry.latestEndMinutes >= slot.endMinutes
        )
      }).length

      if (eligible < floor) {
        found.push({
          code: "hard_floor_unreachable",
          date: slot.date,
          message: `Le ${slot.date}, le créneau ${slot.id} exige un plancher incassable de ${floor} salarié(s) mais seuls ${eligible} peuvent être présents sur cette plage.`,
        })
      }
    }
  }

  return found
}

/**
 * The most minutes one employee can actually work on one day.
 *
 * The subtle part, and the one that produced a whole class of dead skeletons
 * before it was written down: whether an employee MAY SPLIT changes their
 * daily ceiling, because a duration longer than one uninterrupted stretch is
 * only workable in two pieces.
 *
 * Without this, Phase 2 would happily allocate ten hours to someone forbidden
 * to split, Phase 4 would find no legal shape for that day, and the skeleton
 * would be abandoned — reported as "no legal form", which reads like an
 * impossible problem when it is really an impossible allocation. Measured on
 * the Accueil week, that is exactly what happened: every one of 240 skeletons
 * died on the two employees carrying `canSplitShift: false`.
 *
 * For someone who may split, the ceiling additionally accounts for the break
 * itself: two stretches plus a gap must still fit inside their window, so the
 * gap is subtracted rather than assumed free.
 */
function dailyCeiling(
  employee: PlanningEmployeeV3,
  windowMinutes: number,
  rules: EffectiveRules
): number {
  const base = Math.min(employee.maximumDailyMinutes, rules.maximumShiftMinutes, windowMinutes)

  const maySplit =
    rules.splitShiftAllowed && employee.canSplitShift && rules.maximumSplitsPerDay >= 1

  const ceiling = maySplit
    ? Math.min(
        base,
        // Two stretches, each capped by the continuous rule…
        2 * rules.maximumContinuousMinutes,
        // …and the break has to fit in the window alongside them.
        windowMinutes - rules.minimumSplitMinutes
      )
    : Math.min(base, rules.maximumContinuousMinutes)

  return floorToStep(Math.max(0, ceiling), rules.timeStepMinutes)
}

function absent(employeeId: EmployeeId, day: PlanningDayV3): PlanningEmployeeDayV3 {
  return {
    employeeId,
    date: day.date as IsoDate,
    available: false,
    mandatory: false,
    fixedRest: false,
    earliestStartMinutes: day.opensAtMinutes ?? 0,
    latestEndMinutes: day.closesAtMinutes ?? 0,
    maximumMinutes: 0,
    unavailableReason: "no-entry",
  }
}

function floorToStep(value: number, step: number): number {
  return Math.floor(value / step) * step
}
