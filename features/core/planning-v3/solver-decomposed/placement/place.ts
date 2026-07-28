import type {
  DecomposedObjective,
} from "@/features/core/planning-v3/solver-decomposed/objective/objective"
import {
  compareObjective,
  couldStillBeat,
  emptyObjective,
} from "@/features/core/planning-v3/solver-decomposed/objective/objective"
import type {
  DecomposedResolvedOptions,
  DecomposedStopCause,
  ReducedCandidate,
  Skeleton,
} from "@/features/core/planning-v3/solver-decomposed/types"
import type { NormalisedProblem } from "@/features/core/planning-v3/solver-decomposed/diagnostics/normalise"
import type { CandidateSpace } from "@/features/core/planning-v3/solver-decomposed/candidate-generator/generate"
import {
  addPresence,
  buildDayGrid,
  measureCoverage,
  removePresence,
  type DayGrid,
} from "@/features/core/planning-v3/solver-decomposed/placement/coverage-grid"

/**
 * Phase 5 — exact placement.
 *
 * By the time this runs, three things are already settled: how many minutes
 * each employee works each day, who holds each day's opening and closing, and
 * the handful of shapes each worked day may take. What is left is genuinely
 * small, and that is the entire payoff of the decomposition.
 *
 * It runs in two stages because the constraints have two different shapes.
 *
 * Within a day, coverage is the only thing that matters and every employee's
 * choice interacts with every other's — so the day is solved as one unit, and
 * only its best patterns are kept.
 *
 * Across days, the one coupling left is the rest rule: an evening decides what
 * the next morning may do. That is a chain, so the week is a depth-first walk
 * over the retained day patterns with a lexicographic bound, and a branch whose
 * partial objective already loses to the incumbent is cut rather than explored.
 *
 * A HARD FLOOR IS NEVER TRADED. A day pattern that breaks one is discarded at
 * stage one and can never reach the week — it is not a worse pattern, it is not
 * a pattern. That is what keeps an impossibility from quietly becoming an
 * accepted deficit further down the pipeline.
 *
 * No fallback exists here. A search that finds nothing returns nothing, with
 * the reason it stopped.
 */

export interface DayPattern {
  /** Index into `entriesOfDay`, giving the chosen candidate for each employee. */
  readonly choices: readonly ReducedCandidate[]
  readonly underCoveredSlots: number
  readonly deficitMinutes: number
  readonly complexity: number
  /** First worked minute per employee index; -1 when they do not work today. */
  readonly firstStart: readonly number[]
  /** Last worked minute per employee index; -1 when they do not work today. */
  readonly lastEnd: readonly number[]
}

export interface PlacementOutcome {
  readonly shifts: readonly ReducedCandidate[] | null
  readonly objective: DecomposedObjective | null
  readonly stopCause: DecomposedStopCause
  readonly nodes: number
  /** Days for which no legal pattern exists at all, under this skeleton. */
  readonly deadDays: readonly number[]
  /** How many patterns each day contributed. Reported, not acted on. */
  readonly patternCounts: readonly number[]
  /** Why the weekly walk found nothing, when it found nothing. */
  readonly walkNote: string
}

/** How many patterns of one day survive into the weekly walk. */
const DEFAULT_PATTERNS_PER_DAY = 240

/**
 * Nodes one day's enumeration may spend, independent of the weekly budget.
 *
 * Two budgets rather than one because they fail differently. Enumerating a day
 * is bounded work whose cost is known in advance; walking the week is a search
 * whose cost is not. Sharing one pot let the enumeration of six days drain
 * everything the walk needed and report `state-limit` without a single complete
 * schedule having been attempted — which is a resourcing bug wearing the
 * costume of an infeasible problem.
 */
const DAY_ENUMERATION_NODE_LIMIT = 400_000

export function placeWeek(
  normalised: NormalisedProblem,
  skeleton: Skeleton,
  space: CandidateSpace,
  options: DecomposedResolvedOptions,
  constants: { readonly individualDeviationMinutes: number; readonly fairnessSpread: number },
  incumbent: DecomposedObjective | null,
  deadline: number,
  budget: { nodes: number }
): PlacementOutcome {
  const { days, rules } = normalised

  // Entries grouped by day, in skeleton order, with their candidate lists.
  const entriesOfDay: { entryIndex: number; employeeIndex: number; candidates: readonly ReducedCandidate[] }[][] =
    days.map(() => [])
  skeleton.entries.forEach((entry, entryIndex) => {
    entriesOfDay[entry.dayIndex].push({
      entryIndex,
      employeeIndex: entry.employeeIndex,
      candidates: space.byEntry[entryIndex],
    })
  })

  // ── Stage one: the best patterns of each day ─────────────────────────────
  const patternsByDay: DayPattern[][] = []
  const deadDays: number[] = []

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const day = days[dayIndex]
    const working = entriesOfDay[dayIndex]

    if (working.length === 0) {
      // A closed day, or one nobody was allocated to. Still a legal "pattern":
      // the empty one. Its coverage is measured all the same, because a day
      // with demand and nobody on it is under-covered, not absent.
      const grid = buildDayGrid(normalised.slotsByDay[dayIndex], day.opensAtMinutes ?? 0, day.closesAtMinutes ?? 0, rules.timeStepMinutes)
      const counts = new Int32Array(grid.cellCount)
      const coverage = measureCoverage(counts, grid)
      if (coverage.breaksHardFloor) {
        deadDays.push(dayIndex)
        patternsByDay.push([])
        continue
      }
      patternsByDay.push([
        {
          choices: [],
          underCoveredSlots: coverage.underCoveredSlots,
          deficitMinutes: coverage.deficitMinutes,
          complexity: 0,
          firstStart: new Array<number>(normalised.employees.length).fill(-1),
          lastEnd: new Array<number>(normalised.employees.length).fill(-1),
        },
      ])
      continue
    }

    const dayBudget = { nodes: DAY_ENUMERATION_NODE_LIMIT }
    const patterns = enumerateDayPatterns(normalised, dayIndex, working, options, deadline, dayBudget)
    if (patterns.length === 0) deadDays.push(dayIndex)
    patternsByDay.push(patterns)
  }

  const patternCounts = patternsByDay.map((patterns) => patterns.length)

  if (deadDays.length > 0) {
    return {
      shifts: null,
      objective: null,
      stopCause: "exhausted",
      nodes: 0,
      deadDays,
      patternCounts,
      walkNote: `Aucun motif légal pour le(s) jour(s) ${deadDays.join(", ")}.`,
    }
  }

  // ── Stage two: the week ──────────────────────────────────────────────────
  const employeeCount = normalised.employees.length
  const lastWorkedDay = new Array<number>(employeeCount).fill(-1)
  const lastEnd = new Array<number>(employeeCount).fill(-1)
  const chosen: DayPattern[] = []

  let best: DayPattern[] | null = null
  let bestObjective: DecomposedObjective | null = incumbent === null ? null : [...incumbent]
  let bestIsOurs = false
  let stopCause: DecomposedStopCause = "exhausted"
  let nodes = 0
  let restRejections = 0
  let deepestDay = 0

  function partialObjective(underCovered: number, deficit: number, complexity: number): DecomposedObjective {
    const objective = emptyObjective()
    objective[1] = underCovered
    objective[2] = deficit
    objective[5] = constants.individualDeviationMinutes
    objective[6] = constants.fairnessSpread
    objective[8] = complexity
    return objective
  }

  function walk(dayIndex: number, underCovered: number, deficit: number, complexity: number): void {
    if (stopCause !== "exhausted") return
    if (options.signal?.aborted === true) {
      stopCause = "cancelled"
      return
    }
    if (budget.nodes <= 0) {
      stopCause = "state-limit"
      return
    }
    if (Date.now() > deadline) {
      stopCause = "timeout"
      return
    }

    if (dayIndex > deepestDay) deepestDay = dayIndex

    if (dayIndex === days.length) {
      const objective = partialObjective(underCovered, deficit, complexity)
      if (bestObjective === null || compareObjective(objective, bestObjective) < 0) {
        bestObjective = objective
        best = [...chosen]
        bestIsOurs = true
      }
      return
    }

    // The optimistic bound: components 0–5 can only grow from here, and 6–8 are
    // already final for this skeleton, so a partial tuple that loses now loses
    // forever.
    if (!couldStillBeat(partialObjective(underCovered, deficit, complexity), bestObjective)) return

    for (const pattern of patternsByDay[dayIndex]) {
      nodes++
      budget.nodes--
      if (budget.nodes <= 0) {
        stopCause = "state-limit"
        return
      }

      if (!restRespected(pattern, dayIndex)) {
        restRejections++
        continue
      }

      const previousDay: number[] = []
      const previousEnd: number[] = []
      for (let employeeIndex = 0; employeeIndex < employeeCount; employeeIndex++) {
        previousDay.push(lastWorkedDay[employeeIndex])
        previousEnd.push(lastEnd[employeeIndex])
        if (pattern.lastEnd[employeeIndex] >= 0) {
          lastWorkedDay[employeeIndex] = dayIndex
          lastEnd[employeeIndex] = pattern.lastEnd[employeeIndex]
        }
      }
      chosen.push(pattern)

      walk(
        dayIndex + 1,
        underCovered + pattern.underCoveredSlots,
        deficit + pattern.deficitMinutes,
        complexity + pattern.complexity
      )

      chosen.pop()
      for (let employeeIndex = 0; employeeIndex < employeeCount; employeeIndex++) {
        lastWorkedDay[employeeIndex] = previousDay[employeeIndex]
        lastEnd[employeeIndex] = previousEnd[employeeIndex]
      }
      if (stopCause !== "exhausted") return
    }
  }

  /**
   * The rest rule, measured between CONSECUTIVE WORKED days rather than
   * adjacent calendar days — a Tuesday evening followed by a Wednesday off and
   * a Thursday morning is not a rest violation, and treating the calendar as
   * the unit would invent one.
   */
  function restRespected(pattern: DayPattern, dayIndex: number): boolean {
    for (let employeeIndex = 0; employeeIndex < employeeCount; employeeIndex++) {
      const start = pattern.firstStart[employeeIndex]
      if (start < 0) continue
      const previousDay = lastWorkedDay[employeeIndex]
      if (previousDay < 0) continue
      const gapDays = dayIndex - previousDay
      const rest = gapDays * 1_440 - lastEnd[employeeIndex] + start
      if (rest < rules.minimumRestMinutes) return false
    }
    return true
  }

  walk(0, 0, 0, 0)

  const walkNote = `profondeur max ${deepestDay}/${days.length}, ${restRejections} motifs refusés par le repos, ${nodes} nœuds`

  if (best === null || !bestIsOurs) {
    return { shifts: null, objective: null, stopCause, nodes, deadDays: [], patternCounts, walkNote }
  }

  const shifts = (best as DayPattern[]).flatMap((pattern) => pattern.choices)
  return { shifts, objective: bestObjective, stopCause, nodes, deadDays: [], patternCounts, walkNote }
}

/**
 * Every legal combination of one day, reduced to the best few.
 *
 * The day is a small exact search: employees in normalised order, one candidate
 * each, coverage measured on the grid once the day is complete. Patterns
 * breaking a declared floor are dropped outright — see the note above.
 *
 * Only the top slice survives. Keeping every pattern would put the day's whole
 * cross-product into the weekly walk, where it would be re-explored once per
 * branch; keeping the best ones bounds that at the cost of completeness, which
 * is why this engine never claims an optimum.
 */
function enumerateDayPatterns(
  normalised: NormalisedProblem,
  dayIndex: number,
  working: readonly { entryIndex: number; employeeIndex: number; candidates: readonly ReducedCandidate[] }[],
  options: DecomposedResolvedOptions,
  deadline: number,
  budget: { nodes: number }
): DayPattern[] {
  const day = normalised.days[dayIndex]
  const grid: DayGrid = buildDayGrid(
    normalised.slotsByDay[dayIndex],
    day.opensAtMinutes ?? 0,
    day.closesAtMinutes ?? 0,
    normalised.rules.timeStepMinutes
  )
  const counts = new Int32Array(grid.cellCount)
  const employeeCount = normalised.employees.length

  const found: DayPattern[] = []
  const picked: ReducedCandidate[] = []
  let stopped = false

  function recurse(position: number): void {
    if (stopped) return
    if (budget.nodes <= 0 || Date.now() > deadline || options.signal?.aborted === true) {
      stopped = true
      return
    }

    if (position === working.length) {
      budget.nodes--
      const coverage = measureCoverage(counts, grid)
      if (coverage.breaksHardFloor) return

      const firstStart = new Array<number>(employeeCount).fill(-1)
      const lastEnd = new Array<number>(employeeCount).fill(-1)
      let complexity = 0
      for (const candidate of picked) {
        firstStart[candidate.employeeIndex] = candidate.startMinutes
        lastEnd[candidate.employeeIndex] = candidate.endMinutes
        // Prefer plain hours: a split costs far more than an odd start time, so
        // the two can never trade against each other.
        complexity += (candidate.segments.length - 1) * 100
        complexity += candidate.startMinutes % 60 === 0 ? 0 : 1
      }

      found.push({
        choices: [...picked],
        underCoveredSlots: coverage.underCoveredSlots,
        deficitMinutes: coverage.deficitMinutes,
        complexity,
        firstStart,
        lastEnd,
      })
      return
    }

    for (const candidate of working[position].candidates) {
      addPresence(counts, grid, candidate.segments)
      picked.push(candidate)
      recurse(position + 1)
      picked.pop()
      removePresence(counts, grid, candidate.segments)
      if (stopped) return
    }
  }

  recurse(0)

  found.sort(
    (left, right) =>
      left.underCoveredSlots - right.underCoveredSlots ||
      left.deficitMinutes - right.deficitMinutes ||
      left.complexity - right.complexity ||
      compareStarts(left, right)
  )
  return found.slice(0, DEFAULT_PATTERNS_PER_DAY)
}

/** A total tie-break, so equally-good patterns still have a defined order. */
function compareStarts(left: DayPattern, right: DayPattern): number {
  for (let index = 0; index < left.firstStart.length; index++) {
    const difference = (left.firstStart[index] ?? -1) - (right.firstStart[index] ?? -1)
    if (difference !== 0) return difference
  }
  for (let index = 0; index < left.lastEnd.length; index++) {
    const difference = (left.lastEnd[index] ?? -1) - (right.lastEnd[index] ?? -1)
    if (difference !== 0) return difference
  }
  return 0
}
