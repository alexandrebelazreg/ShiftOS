import type { EmployeeId, IsoDate } from "@/features/core/models"

import type {
  PlanningDayV3,
  PlanningEmployeeV3,
  PlanningProblemV3,
} from "@/features/core/planning-v3/types/problem"

/**
 * Exhaustive generation of the legal continuous shifts.
 *
 * For every employee and every day, EVERY start and EVERY duration allowed by
 * the rules is produced, on the problem's time step. No candidate is dropped
 * for looking redundant: two shifts covering the same demand slots can still
 * differ in what they allow the next morning, because the rest rule reads the
 * end time. Coverage-based deduplication would therefore be unsound, and is
 * not performed.
 *
 * The only filtering applied is by hard rules that can be decided from the
 * candidate alone — an employee without CAN_OPEN never gets a candidate that
 * starts at opening, so the illegal branch is never explored rather than
 * explored and rejected.
 *
 * Split shifts are NOT enumerated in V3B. The generated space is therefore
 * complete for continuous shifts only, which the proof states explicitly.
 */

export interface SolverCandidateV3 {
  readonly employeeId: EmployeeId
  readonly date: IsoDate
  readonly startMinutes: number
  readonly endMinutes: number
  readonly minutes: number
  readonly opensDay: boolean
  readonly closesDay: boolean
  /** Indexes into the day's slot list that this shift covers entirely. */
  readonly coveredSlots: readonly number[]
  /** True for the zero-minute "day off" candidate. */
  readonly isRest: boolean
}

export interface DayCandidatesV3 {
  readonly date: IsoDate
  readonly slots: readonly { readonly index: number; readonly requiredEmployees: number; readonly durationMinutes: number }[]
  /** Candidates per employee, in the problem's employee order. */
  readonly byEmployee: readonly (readonly SolverCandidateV3[])[]
}

export interface CandidateSpaceV3 {
  readonly days: readonly DayCandidatesV3[]
  readonly totalCandidates: number
  /** False as long as split shifts are not enumerated. */
  readonly splitShiftsEnumerated: boolean
}

export function generateCandidateSpace(problem: PlanningProblemV3): CandidateSpaceV3 {
  const days: DayCandidatesV3[] = []
  let totalCandidates = 0

  for (const day of problem.days) {
    const daySlots = problem.demandSlots
      .filter((slot) => slot.date === day.date)
      .map((slot, index) => ({
        index,
        startMinutes: slot.startMinutes,
        endMinutes: slot.endMinutes,
        requiredEmployees: slot.requiredEmployees,
        durationMinutes: slot.endMinutes - slot.startMinutes,
      }))

    const byEmployee = problem.employees.map((employee) => {
      const candidates = candidatesFor(problem, day, employee, daySlots)
      totalCandidates += candidates.length
      return candidates
    })

    days.push({
      date: day.date,
      slots: daySlots.map(({ index, requiredEmployees, durationMinutes }) => ({
        index,
        requiredEmployees,
        durationMinutes,
      })),
      byEmployee,
    })
  }

  return { days, totalCandidates, splitShiftsEnumerated: false }
}

function candidatesFor(
  problem: PlanningProblemV3,
  day: PlanningDayV3,
  employee: PlanningEmployeeV3,
  slots: readonly { index: number; startMinutes: number; endMinutes: number }[]
): SolverCandidateV3[] {
  const entry = problem.employeeDays.find(
    (item) => item.employeeId === employee.id && item.date === day.date
  )
  const rest: SolverCandidateV3 = {
    employeeId: employee.id,
    date: day.date,
    startMinutes: 0,
    endMinutes: 0,
    minutes: 0,
    opensDay: false,
    closesDay: false,
    coveredSlots: [],
    isRest: true,
  }

  // A mandatory day has no rest candidate at all — the constraint is expressed
  // by the absence of the option, not by a later rejection.
  if (!entry || !entry.available) return entry?.mandatory ? [] : [rest]
  if (day.closed || day.opensAtMinutes === null || day.closesAtMinutes === null) {
    return entry.mandatory ? [] : [rest]
  }

  const step = problem.timeStepMinutes
  const minimum = Math.max(problem.rules.minimumShiftMinutes, step)
  const maximum = Math.min(problem.rules.maximumShiftMinutes, entry.maximumMinutes)
  const candidates: SolverCandidateV3[] = []

  for (let duration = ceilToStep(minimum, step); duration <= maximum; duration += step) {
    for (
      let start = ceilToStep(entry.earliestStartMinutes, step);
      start + duration <= entry.latestEndMinutes;
      start += step
    ) {
      const end = start + duration
      const opensDay = start === day.opensAtMinutes
      const closesDay = end === day.closesAtMinutes
      if (opensDay && !employee.canOpen) continue
      if (closesDay && !employee.canClose) continue

      const coveredSlots: number[] = []
      for (const slot of slots) {
        if (start <= slot.startMinutes && end >= slot.endMinutes) coveredSlots.push(slot.index)
      }

      candidates.push({
        employeeId: employee.id,
        date: day.date,
        startMinutes: start,
        endMinutes: end,
        minutes: duration,
        opensDay,
        closesDay,
        coveredSlots,
        isRest: false,
      })
    }
  }

  if (!entry.mandatory) candidates.push(rest)

  // A stable order is what makes the whole search reproducible.
  candidates.sort(
    (left, right) =>
      Number(left.isRest) - Number(right.isRest) ||
      left.startMinutes - right.startMinutes ||
      left.endMinutes - right.endMinutes
  )
  return candidates
}

function ceilToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step
}
