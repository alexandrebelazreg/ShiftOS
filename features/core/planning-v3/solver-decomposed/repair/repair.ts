import type { DecomposedObjective } from "@/features/core/planning-v3/solver-decomposed/objective/objective"
import { compareObjective } from "@/features/core/planning-v3/solver-decomposed/objective/objective"
import type {
  DecomposedResolvedOptions,
  ReducedCandidate,
} from "@/features/core/planning-v3/solver-decomposed/types"
import type { NormalisedProblem } from "@/features/core/planning-v3/solver-decomposed/diagnostics/normalise"
import {
  addPresence,
  buildDayGrid,
  measureCoverage,
} from "@/features/core/planning-v3/solver-decomposed/placement/coverage-grid"

/**
 * Phase 6 — bounded local repair.
 *
 * A finishing pass, and deliberately a timid one. It slides whole shifts by a
 * few steps and keeps a move only when the lexicographic objective STRICTLY
 * improves. Three properties make it safe to run on a schedule someone is about
 * to publish:
 *
 * - it never breaks a hard constraint — every move is re-checked in full, and a
 *   move that would break one is not scored, it is discarded;
 * - it never increases the deficit — that falls out of "strictly better
 *   lexicographically", since deficit sits above every objective a move could
 *   plausibly be chasing;
 * - it moves each employee by at most `MAXIMUM_DRIFT_MINUTES` in total, summed
 *   in absolute value across the week, so a manager who has already read the
 *   schedule does not find it rewritten.
 *
 * Shifts holding an opening or a closing are IMMOVABLE. Sliding one would move
 * the boundary it exists to hold, silently vacating a role the skeleton
 * assigned and a weekly cap already accounted for.
 *
 * Deterministic and optional. Shifts are visited in a total order and the first
 * strictly-improving offset wins; disabling the phase changes the result but
 * never its legality.
 */

/** Total absolute displacement one employee may absorb, across the whole week. */
export const MAXIMUM_DRIFT_MINUTES = 30

export interface RepairOutcome {
  readonly shifts: readonly ReducedCandidate[]
  readonly objective: DecomposedObjective
  readonly tested: number
  readonly applied: number
}

export function repairLocally(
  normalised: NormalisedProblem,
  shifts: readonly ReducedCandidate[],
  objective: DecomposedObjective,
  options: DecomposedResolvedOptions,
  deadline: number
): RepairOutcome {
  const step = normalised.rules.timeStepMinutes
  const offsets: number[] = []
  for (let drift = step; drift <= MAXIMUM_DRIFT_MINUTES; drift += step) {
    offsets.push(-drift, drift)
  }

  let current = [...shifts]
  let currentObjective = objective
  const driftUsed = new Array<number>(normalised.employees.length).fill(0)
  let tested = 0
  let applied = 0

  let improved = true
  while (improved) {
    improved = false
    if (Date.now() > deadline || options.signal?.aborted === true) break

    // A total order over the shifts, so two runs try the same moves in the same
    // sequence and land on the same schedule.
    const order = current
      .map((shift, index) => ({ shift, index }))
      .sort(
        (left, right) =>
          left.shift.dayIndex - right.shift.dayIndex ||
          left.shift.employeeIndex - right.shift.employeeIndex
      )

    for (const { shift, index } of order) {
      if (shift.opens || shift.closes) continue
      if (Date.now() > deadline) break

      for (const offset of offsets) {
        const budgetLeft = MAXIMUM_DRIFT_MINUTES - driftUsed[shift.employeeIndex]
        if (Math.abs(offset) > budgetLeft) continue

        const moved = translate(shift, offset)
        if (!isLegal(normalised, moved)) continue

        const attempt = [...current]
        attempt[index] = moved
        tested++

        if (!restRespectedFor(normalised, attempt, moved.employeeIndex)) continue

        const attemptObjective = scoreWeek(normalised, attempt, currentObjective)
        if (attemptObjective === null) continue
        if (compareObjective(attemptObjective, currentObjective) >= 0) continue

        current = attempt
        currentObjective = attemptObjective
        driftUsed[shift.employeeIndex] += Math.abs(offset)
        applied++
        improved = true
        break
      }
      if (improved) break
    }
  }

  return { shifts: current, objective: currentObjective, tested, applied }
}

function translate(shift: ReducedCandidate, offset: number): ReducedCandidate {
  return {
    ...shift,
    segments: shift.segments.map((segment) => ({
      startMinutes: segment.startMinutes + offset,
      endMinutes: segment.endMinutes + offset,
    })),
    startMinutes: shift.startMinutes + offset,
    endMinutes: shift.endMinutes + offset,
  }
}

/**
 * Everything a slid shift must still satisfy on its own.
 *
 * Role neutrality is the subtle one: a shift that was neither opener nor closer
 * must not BECOME one by drifting onto a boundary, or the day quietly grows an
 * extra opening that the weekly caps never budgeted for.
 */
function isLegal(normalised: NormalisedProblem, shift: ReducedCandidate): boolean {
  const window = normalised.entries[shift.employeeIndex][shift.dayIndex]
  const day = normalised.days[shift.dayIndex]

  if (shift.startMinutes < window.earliestStartMinutes) return false
  if (shift.endMinutes > window.latestEndMinutes) return false
  if (shift.startMinutes === (day.opensAtMinutes ?? -1)) return false
  if (shift.endMinutes === (day.closesAtMinutes ?? -1)) return false
  return true
}

/** The rest rule for one employee's week, recomputed from scratch. */
function restRespectedFor(
  normalised: NormalisedProblem,
  shifts: readonly ReducedCandidate[],
  employeeIndex: number
): boolean {
  const worked = shifts
    .filter((shift) => shift.employeeIndex === employeeIndex)
    .sort((left, right) => left.dayIndex - right.dayIndex)

  for (let index = 1; index < worked.length; index++) {
    const previous = worked[index - 1]
    const current = worked[index]
    const rest = (current.dayIndex - previous.dayIndex) * 1_440 - previous.endMinutes + current.startMinutes
    if (rest < normalised.rules.minimumRestMinutes) return false
  }
  return true
}

/**
 * Rescore a whole week.
 *
 * Returns null when the week breaks a declared floor, which is how a repair
 * that would trade an unbreakable minimum for a better soft score is refused
 * rather than merely scored badly.
 */
function scoreWeek(
  normalised: NormalisedProblem,
  shifts: readonly ReducedCandidate[],
  reference: DecomposedObjective
): DecomposedObjective | null {
  let underCovered = 0
  let deficit = 0
  let complexity = 0

  for (let dayIndex = 0; dayIndex < normalised.days.length; dayIndex++) {
    const day = normalised.days[dayIndex]
    const grid = buildDayGrid(
      normalised.slotsByDay[dayIndex],
      day.opensAtMinutes ?? 0,
      day.closesAtMinutes ?? 0,
      normalised.rules.timeStepMinutes
    )
    const counts = new Int32Array(grid.cellCount)
    for (const shift of shifts) {
      if (shift.dayIndex !== dayIndex) continue
      addPresence(counts, grid, shift.segments)
      complexity += (shift.segments.length - 1) * 100
      complexity += shift.startMinutes % 60 === 0 ? 0 : 1
    }

    const coverage = measureCoverage(counts, grid)
    if (coverage.breaksHardFloor) return null
    underCovered += coverage.underCoveredSlots
    deficit += coverage.deficitMinutes
  }

  const objective = [...reference]
  objective[1] = underCovered
  objective[2] = deficit
  objective[8] = complexity
  return objective
}
