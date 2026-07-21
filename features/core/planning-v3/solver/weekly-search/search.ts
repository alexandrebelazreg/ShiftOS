import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolverOptionsV3 } from "@/features/core/planning-v3/types/solver"
import type {
  CandidateSpaceV3,
  SolverCandidateV3,
} from "@/features/core/planning-v3/solver/candidate-generator/generate-candidates"
import type { SolverModelV3 } from "@/features/core/planning-v3/solver/daily-patterns/day-model"
import {
  compareObjective,
  couldStillBeat,
  emptyObjective,
  type ObjectiveVector,
} from "@/features/core/planning-v3/solver/objective/objective"

/**
 * The weekly search: one depth-first branch-and-bound over the WHOLE period.
 *
 * Why weekly rather than day after day? Because the binding constraints ARE
 * weekly — a contract that must land exactly on its minutes, a rest that
 * couples one evening to the next morning, opening and closing caps counted
 * over the week. A daily engine cannot see any of them, which is why the V2
 * pipeline needed repair passes bolted on afterwards.
 *
 * Each day is decided in two phases, and the split is what makes the search
 * tractable at all:
 *
 * 1. HOW MANY minutes each employee works that day. The exact daily budget is
 *    a constraint on this vector alone, so it is settled after a handful of
 *    choices among ~25 durations, and the last employee is fully forced.
 * 2. WHEN those minutes are worked. Only now do start times matter, and by
 *    then coverage, the opener, the closer and the rest rule prune hard.
 *
 * Deciding both at once — picking whole candidates straight away — was
 * measured at 20 million states without completing a single Drive week: the
 * budget could only be tested after five choices among 725 candidates, so the
 * search drowned before reaching the second day.
 *
 * Exactness rests on two properties:
 * - every cut is either a FEASIBILITY cut (no legal completion exists below the
 *   node, proven by the suffix bounds) or a BOUND cut (the additive objective
 *   components already lose to the incumbent and can only grow). Neither can
 *   discard an optimum.
 * - all iteration orders are fixed, so the same problem always yields the same
 *   schedule, including which of several equally good ones comes back.
 *
 * Ordering heuristics only choose which branch is visited FIRST, never which
 * branches exist. There is no beam, no top-N, no hidden cap: the only stops are
 * the declared `timeoutMs` and `maximumStates`, and hitting either is recorded
 * and forbids any optimality claim.
 */

export type SearchStopCause = "exhausted" | "timeout" | "state-limit" | "cancelled"

export interface SearchOutcomeV3 {
  readonly assignments: readonly SolverCandidateV3[] | null
  readonly objective: ObjectiveVector | null
  readonly stopCause: SearchStopCause
  readonly statesEvaluated: number
  readonly dailyPatternsEvaluated: number
  readonly prunedByBound: number
  readonly prunedByFeasibility: number
  readonly peakDepth: number
}

export function searchWeek(
  problem: PlanningProblemV3,
  space: CandidateSpaceV3,
  model: SolverModelV3,
  options: PlanningSolverOptionsV3
): SearchOutcomeV3 {
  const employeeCount = problem.employees.length
  const dayCount = problem.days.length
  const rules = problem.rules
  const totalContract = problem.employees.reduce((sum, e) => sum + e.contractMinutes, 0)
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? 30_000
  const maximumStates = options.maximumStates ?? 5_000_000

  /**
   * Durations available to each employee each day, ordered by distance to that
   * employee's fair share of the budget. Visiting the fair duration first finds
   * a low-deviation schedule early, which then prunes hard through the bound.
   */
  const allowedMinutes: number[][][] = model.days.map((day, dayIndex) =>
    day.employees.map((entry, employeeIndex) => {
      const target = model.distributionTarget[employeeIndex][dayIndex]
      return [...entry.byMinutes.keys()].sort(
        (left, right) => Math.abs(left - target) - Math.abs(right - target) || left - right
      )
    })
  )

  // ── Mutable state, restored on backtrack ─────────────────────────────────
  const remaining = problem.employees.map((employee) => employee.contractMinutes)
  const lastEnd = new Array<number>(employeeCount).fill(-1)
  const lastWorkedDay = new Array<number>(employeeCount).fill(-1)
  const streak = new Array<number>(employeeCount).fill(0)
  const openings = new Array<number>(employeeCount).fill(0)
  const closings = new Array<number>(employeeCount).fill(0)
  const minutesToday = new Array<number>(employeeCount).fill(0)
  const chosen: SolverCandidateV3[][] = problem.days.map(() => new Array(employeeCount))

  let best: SolverCandidateV3[] | null = null
  let bestObjective: ObjectiveVector | null = null
  let bestKey: string | null = null
  let stopCause: SearchStopCause = "exhausted"
  let statesEvaluated = 0
  let dailyPatternsEvaluated = 0
  let prunedByBound = 0
  let prunedByFeasibility = 0
  let peakDepth = 0

  function limitReached(): boolean {
    if (stopCause !== "exhausted") return true
    if (options.signal?.aborted) return ((stopCause = "cancelled"), true)
    if (statesEvaluated >= maximumStates) return ((stopCause = "state-limit"), true)
    if ((statesEvaluated & 0xfff) === 0 && Date.now() - startedAt > timeoutMs) {
      return ((stopCause = "timeout"), true)
    }
    return false
  }

  // ── Day walk ──────────────────────────────────────────────────────────────
  function solveDay(dayIndex: number, partial: ObjectiveVector): void {
    if (limitReached()) return
    if (dayIndex === dayCount) {
      if (remaining.some((value) => value !== 0)) return
      dailyPatternsEvaluated++
      recordIfBest(finalObjective(partial))
      return
    }
    chooseMinutes(dayIndex, 0, 0, partial)
  }

  /** Phase 1 — how many minutes each employee works today. */
  function chooseMinutes(
    dayIndex: number,
    employeeIndex: number,
    dayMinutes: number,
    partial: ObjectiveVector
  ): void {
    if (limitReached()) return
    statesEvaluated++
    const day = model.days[dayIndex]

    if (employeeIndex === employeeCount) {
      if (dayMinutes !== day.budgetMinutes) return
      const coverage = new Array<number>(day.slotRequirements.length).fill(0)
      placeEmployee(dayIndex, 0, 0, 0, coverage, partial)
      return
    }

    const needed = day.budgetMinutes - dayMinutes
    if (needed < day.minimumSuffix[employeeIndex] || needed > day.maximumSuffix[employeeIndex]) {
      prunedByFeasibility++
      return
    }

    const isLast = employeeIndex === employeeCount - 1
    for (const minutes of allowedMinutes[dayIndex][employeeIndex]) {
      if (limitReached()) return
      // The last employee has no freedom: the budget fixes their minutes.
      if (isLast && minutes !== needed) continue
      if (minutes > needed) continue

      const nextRemaining = remaining[employeeIndex] - minutes
      if (nextRemaining < model.weeklyMinimum[employeeIndex][dayIndex + 1]) continue
      if (nextRemaining > model.weeklyMaximum[employeeIndex][dayIndex + 1]) continue

      minutesToday[employeeIndex] = minutes
      remaining[employeeIndex] = nextRemaining
      chooseMinutes(dayIndex, employeeIndex + 1, dayMinutes + minutes, partial)
      remaining[employeeIndex] = nextRemaining + minutes
    }
  }

  /** Phase 2 — when today's minutes are worked. */
  function placeEmployee(
    dayIndex: number,
    employeeIndex: number,
    openerCount: number,
    closerCount: number,
    coverage: number[],
    partial: ObjectiveVector
  ): void {
    if (limitReached()) return
    statesEvaluated++
    peakDepth = Math.max(peakDepth, dayIndex * employeeCount + employeeIndex)
    const day = model.days[dayIndex]

    if (employeeIndex === employeeCount) {
      if (openerCount < day.requiredMinimumOpenings || closerCount !== day.requiredExactClosings) return
      const contribution = dayContribution(dayIndex, coverage, partial)
      if (!couldStillBeat(contribution, bestObjective)) {
        prunedByBound++
        return
      }
      solveDay(dayIndex + 1, contribution)
      return
    }

    if (openerCount + day.openersSuffix[employeeIndex] < day.requiredMinimumOpenings) {
      prunedByFeasibility++
      return
    }
    if (closerCount + day.closersSuffix[employeeIndex] < day.requiredExactClosings) {
      prunedByFeasibility++
      return
    }

    const employee = problem.employees[employeeIndex]
    const pool = day.employees[employeeIndex].byMinutes.get(minutesToday[employeeIndex]) ?? []

    // Visit the shifts that close the most STILL-OPEN gaps first. Trying start
    // times in clock order piles everyone into the morning and leaves the
    // evening bare; this looks at what is actually missing right now. It is a
    // pure ordering — every candidate is still visited, so nothing is pruned.
    const ordered =
      pool.length < 2
        ? pool
        : [...pool].sort((left, right) => {
            const gain = coverageGain(right, coverage, day.slotRequirements) - coverageGain(left, coverage, day.slotRequirements)
            return gain !== 0 ? gain : left.startMinutes - right.startMinutes
          })

    for (const candidate of ordered) {
      if (limitReached()) return

      const nextOpeners = openerCount + (candidate.opensDay ? 1 : 0)
      const nextClosers = closerCount + (candidate.closesDay ? 1 : 0)
      if (nextClosers > day.requiredExactClosings) continue
      if (employee.maximumOpenings !== null && openings[employeeIndex] + (candidate.opensDay ? 1 : 0) > employee.maximumOpenings) continue
      if (employee.maximumClosings !== null && closings[employeeIndex] + (candidate.closesDay ? 1 : 0) > employee.maximumClosings) continue

      let nextStreak = 0
      if (!candidate.isRest) {
        const previous = lastWorkedDay[employeeIndex]
        if (previous >= 0) {
          const rest = (dayIndex - previous) * 1_440 - lastEnd[employeeIndex] + candidate.startMinutes
          if (rest < rules.minimumRestMinutes) continue
        }
        nextStreak = previous === dayIndex - 1 ? streak[employeeIndex] + 1 : 1
        if (rules.maximumConsecutiveWorkedDays !== null && nextStreak > rules.maximumConsecutiveWorkedDays) continue
      }

      const savedEnd = lastEnd[employeeIndex]
      const savedDay = lastWorkedDay[employeeIndex]
      const savedStreak = streak[employeeIndex]
      chosen[dayIndex][employeeIndex] = candidate
      if (!candidate.isRest) {
        lastEnd[employeeIndex] = candidate.endMinutes
        lastWorkedDay[employeeIndex] = dayIndex
        streak[employeeIndex] = nextStreak
        openings[employeeIndex] += candidate.opensDay ? 1 : 0
        closings[employeeIndex] += candidate.closesDay ? 1 : 0
        for (const slot of candidate.coveredSlots) coverage[slot]++
      }

      placeEmployee(dayIndex, employeeIndex + 1, nextOpeners, nextClosers, coverage, partial)

      if (!candidate.isRest) {
        for (const slot of candidate.coveredSlots) coverage[slot]--
        openings[employeeIndex] -= candidate.opensDay ? 1 : 0
        closings[employeeIndex] -= candidate.closesDay ? 1 : 0
      }
      lastEnd[employeeIndex] = savedEnd
      lastWorkedDay[employeeIndex] = savedDay
      streak[employeeIndex] = savedStreak
    }
  }

  function recordIfBest(complete: ObjectiveVector): void {
    const order = bestObjective === null ? -1 : compareObjective(complete, bestObjective)
    if (order > 0) return
    const flattened = chosen.flatMap((day) => day.slice())
    const key = solutionKey(flattened)
    if (order === 0 && bestKey !== null && key >= bestKey) return
    bestObjective = complete
    best = flattened
    bestKey = key
  }

  /** Add one finished day's additive components to the running vector. */
  function dayContribution(
    dayIndex: number,
    coverage: readonly number[],
    partial: ObjectiveVector
  ): ObjectiveVector {
    const day = model.days[dayIndex]
    const next = partial.slice()
    let underCovered = 0
    let deficitMinutes = 0
    for (let slot = 0; slot < coverage.length; slot++) {
      const missing = day.slotRequirements[slot] - coverage[slot]
      if (missing > 0) {
        underCovered++
        deficitMinutes += missing * day.slotDurations[slot]
      }
    }
    next[1] += underCovered
    next[2] += deficitMinutes

    // Worked minutes equal the budget by construction, so the surplus beyond the
    // demand is `budget - required + deficit`; its structural part is fixed by
    // the problem and cannot be blamed on this schedule.
    const surplus = day.budgetMinutes - (day.requiredMinutes - deficitMinutes)
    next[5] += Math.max(0, surplus - day.structuralSurplusMinutes)

    let deviation = 0
    let preference = 0
    for (let employee = 0; employee < employeeCount; employee++) {
      const candidate = chosen[dayIndex][employee]
      const person = problem.employees[employee]
      // Scaled by the total contract so the deviation stays exact integers.
      deviation += Math.abs(
        candidate.minutes * totalContract - person.contractMinutes * day.budgetMinutes
      )
      if (!candidate.isRest) {
        if (person.prefersClosing && !candidate.closesDay) preference++
        if (person.prefersOpening && !candidate.opensDay) preference++
      }
    }
    next[6] += deviation
    next[7] += preference
    return next
  }

  /** Components that only exist once the whole week is known. */
  function finalObjective(partial: ObjectiveVector): ObjectiveVector {
    const complete = partial.slice()
    complete[8] = spread(openings) + spread(closings)
    return complete
  }

  void space
  solveDay(0, emptyObjective())

  return {
    assignments: best,
    objective: bestObjective,
    stopCause,
    statesEvaluated,
    dailyPatternsEvaluated,
    prunedByBound,
    prunedByFeasibility,
    peakDepth,
  }
}

function spread(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values)
}

/** How many slots that are still short this candidate would help cover. */
function coverageGain(
  candidate: SolverCandidateV3,
  coverage: readonly number[],
  requirements: readonly number[]
): number {
  let gain = 0
  for (const slot of candidate.coveredSlots) {
    if (coverage[slot] < requirements[slot]) gain++
  }
  return gain
}

/**
 * Canonical text for a complete assignment, used as the final tie-break.
 * Sorted, so it describes the schedule itself and not the order the search
 * happened to build it in.
 */
export function solutionKey(candidates: readonly SolverCandidateV3[]): string {
  return candidates
    .filter((candidate) => !candidate.isRest)
    .map(
      (candidate) =>
        `${candidate.date}|${String(candidate.employeeId)}|${candidate.startMinutes}-${candidate.endMinutes}`
    )
    .sort()
    .join(";")
}
