import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type {
  CandidateSpaceV3,
  SolverCandidateV3,
} from "@/features/core/planning-v3/solver/candidate-generator/generate-candidates"

/**
 * Precomputed facts about each day, used to decide a partial day assignment is
 * already doomed instead of finishing it and rejecting it.
 *
 * Everything here is derived from the candidate space alone, so it is exact:
 * a branch cut by these numbers provably contains no legal completion.
 */

export interface EmployeeDayModelV3 {
  /** Shortest worked shift available, or 0 when the day may be a rest. */
  readonly minimumMinutes: number
  readonly maximumMinutes: number
  readonly mustWork: boolean
  readonly canOpenToday: boolean
  readonly canCloseToday: boolean
  /** Candidates indexed by exact worked minutes, for exact-budget closing. */
  readonly byMinutes: ReadonlyMap<number, readonly SolverCandidateV3[]>
}

export interface DayModelV3 {
  readonly date: string
  readonly closed: boolean
  /**
   * Openings/closings this day actually requires. A closed day requires none —
   * the store rule is "one opener per OPEN day", and demanding one on a day
   * nobody works makes every schedule infeasible.
   */
  readonly requiredMinimumOpenings: number
  readonly requiredExactClosings: number
  readonly budgetMinutes: number
  readonly requiredMinutes: number
  readonly structuralSurplusMinutes: number
  readonly slotRequirements: readonly number[]
  readonly slotDurations: readonly number[]
  readonly employees: readonly EmployeeDayModelV3[]
  /** `minimumSuffix[i]` = minutes employees `i..n-1` must work, at minimum. */
  readonly minimumSuffix: readonly number[]
  readonly maximumSuffix: readonly number[]
  /** How many of employees `i..n-1` could still open / close the day. */
  readonly openersSuffix: readonly number[]
  readonly closersSuffix: readonly number[]
}

export interface SolverModelV3 {
  readonly days: readonly DayModelV3[]
  /** `weeklyMinimum[e][d]` = minutes employee `e` must still work from day `d`. */
  readonly weeklyMinimum: readonly (readonly number[])[]
  readonly weeklyMaximum: readonly (readonly number[])[]
  /** Per-employee, per-day fair share of the daily budget. */
  readonly distributionTarget: readonly (readonly number[])[]
}

export function buildSolverModel(
  problem: PlanningProblemV3,
  space: CandidateSpaceV3
): SolverModelV3 {
  const employeeCount = problem.employees.length
  const totalContract = problem.employees.reduce(
    (sum, employee) => sum + employee.contractMinutes,
    0
  )

  const days: DayModelV3[] = problem.days.map((day, dayIndex) => {
    const dayCandidates = space.days[dayIndex]
    const slotRequirements = dayCandidates.slots.map((slot) => slot.requiredEmployees)
    const slotDurations = dayCandidates.slots.map((slot) => slot.durationMinutes)
    const requiredMinutes = dayCandidates.slots.reduce(
      (sum, slot) => sum + slot.requiredEmployees * slot.durationMinutes,
      0
    )

    const employees: EmployeeDayModelV3[] = dayCandidates.byEmployee.map((candidates) => {
      const worked = candidates.filter((candidate) => !candidate.isRest)
      const byMinutes = new Map<number, SolverCandidateV3[]>()
      for (const candidate of candidates) {
        const bucket = byMinutes.get(candidate.minutes)
        if (bucket) bucket.push(candidate)
        else byMinutes.set(candidate.minutes, [candidate])
      }
      const mustWork = candidates.length > 0 && candidates.every((c) => !c.isRest)
      return {
        minimumMinutes: mustWork
          ? Math.min(...worked.map((candidate) => candidate.minutes))
          : 0,
        maximumMinutes: worked.length
          ? Math.max(...worked.map((candidate) => candidate.minutes))
          : 0,
        mustWork,
        canOpenToday: candidates.some((candidate) => candidate.opensDay),
        canCloseToday: candidates.some((candidate) => candidate.closesDay),
        byMinutes,
      }
    })

    return {
      date: day.date,
      closed: day.closed,
      requiredMinimumOpenings: day.closed ? 0 : problem.rules.minimumOpeningsPerDay,
      requiredExactClosings: day.closed ? 0 : problem.rules.exactClosingsPerDay,
      budgetMinutes: day.budgetMinutes,
      requiredMinutes,
      structuralSurplusMinutes: Math.max(0, day.budgetMinutes - requiredMinutes),
      slotRequirements,
      slotDurations,
      employees,
      minimumSuffix: suffix(employees.map((entry) => entry.minimumMinutes)),
      maximumSuffix: suffix(employees.map((entry) => entry.maximumMinutes)),
      openersSuffix: suffix(employees.map((entry) => (entry.canOpenToday ? 1 : 0))),
      closersSuffix: suffix(employees.map((entry) => (entry.canCloseToday ? 1 : 0))),
    }
  })

  const weeklyMinimum: number[][] = []
  const weeklyMaximum: number[][] = []
  const distributionTarget: number[][] = []
  for (let employee = 0; employee < employeeCount; employee++) {
    const minimums = days.map((day) => day.employees[employee].minimumMinutes)
    const maximums = days.map((day) => day.employees[employee].maximumMinutes)
    weeklyMinimum.push(suffix(minimums))
    weeklyMaximum.push(suffix(maximums))
    distributionTarget.push(
      days.map((day) =>
        totalContract === 0
          ? 0
          : (problem.employees[employee].contractMinutes * day.budgetMinutes) / totalContract
      )
    )
  }

  return { days, weeklyMinimum, weeklyMaximum, distributionTarget }
}

/** `result[i]` = sum of `values[i..n-1]`; `result[n]` = 0. */
function suffix(values: readonly number[]): number[] {
  const result = new Array<number>(values.length + 1).fill(0)
  for (let index = values.length - 1; index >= 0; index--) {
    result[index] = result[index + 1] + values[index]
  }
  return result
}
