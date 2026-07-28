import type {
  Allocation,
  Skeleton,
  SkeletonEntry,
} from "@/features/core/planning-v3/solver-decomposed/types"
import type { NormalisedProblem } from "@/features/core/planning-v3/solver-decomposed/diagnostics/normalise"
import type { WeekAnalysis } from "@/features/core/planning-v3/solver-decomposed/skeleton/week-analysis"
import {
  analyseWeek,
  restConflict,
} from "@/features/core/planning-v3/solver-decomposed/skeleton/week-analysis"
import type {
  DayRoles,
  SkeletonScore,
} from "@/features/core/planning-v3/solver-decomposed/skeleton/skeleton-score"
import {
  compareSkeletonScore,
  describeSkeletonScore,
  scoreSkeleton,
} from "@/features/core/planning-v3/solver-decomposed/skeleton/skeleton-score"

/**
 * Phase 3 — the weekly skeleton: who opens, who closes, who splits.
 *
 * These are decided BEFORE any exact hour because they are WEEKLY facts. "At
 * most two closings each" is a sentence about the week; deciding it while
 * placing the first day means discovering on the last one that the only
 * eligible closer is already at their cap.
 *
 * Opening and closing stay asymmetric, following the model:
 * `minimumOpeningsPerDay` is a FLOOR raised by whatever the demand asks for at
 * the opening instant, while `exactClosingsPerDay` is exact, because locking up
 * is one person's job and a second closer is a defect rather than coverage.
 *
 * The skeleton is BINDING on Phase 5 in both directions: a designated opener
 * must start at opening, and an employee who is not designated must not.
 *
 * ── Why this file was rebuilt ─────────────────────────────────────────────
 *
 * It used to walk the week chronologically and hand each duty to whoever had
 * taken the fewest so far, yielding the first six feasible results. Fair, and
 * blind: coverage was never consulted, so a skeleton leaving one opener against
 * a demand of four ranked exactly as well as one leaving four. An audit of the
 * Drive week measured the cost — six of the eight under-covered slots were
 * already unavoidable the moment the skeleton was fixed, before the placement
 * had made a single decision.
 *
 * So selection now runs in the brief's priority order: hard constraints, then
 * critical days, then scarce opening and closing capabilities, then coverage
 * potential, then rest fragility, and only then fairness. Candidates come from
 * several deterministic FAMILIES rather than one greedy walk — six variants of
 * a single walk are six near-identical skeletons — and every candidate is
 * scored by `scoreSkeleton` before any placement budget is spent on it.
 *
 * Determinism is unchanged: every ordering is total and value-based, families
 * run in a fixed sequence, and ties fall back to employee and day index.
 */

/** How many complete skeletons each family may contribute to the pool. */
const PER_FAMILY_LIMIT = 10

/**
 * How a family walks the week.
 *
 * The three knobs are the day order and the two within-day preference orders.
 * Everything else — the hard constraints, the sizes tried, the scoring — is
 * shared, so a family can only change WHICH legal skeleton is found first, never
 * whether it is legal.
 */
interface Family {
  readonly name: string
  readonly dayOrder: (analysis: WeekAnalysis) => readonly number[]
  readonly openerOrder: (context: OrderContext) => (left: number, right: number) => number
  readonly closerOrder: (context: OrderContext) => (left: number, right: number) => number
  /**
   * True when a contended opening capability must be kept back from a day that
   * already has spare candidates.
   */
  readonly reserveContendedOpenings?: boolean
}

interface OrderContext {
  readonly analysis: WeekAnalysis
  readonly normalised: NormalisedProblem
  readonly dayIndex: number
  readonly openingsUsed: readonly number[]
  readonly closingsUsed: readonly number[]
}

/** Least contended first: spend the abundant capability, keep the scarce one. */
function abundantOpenersFirst(context: OrderContext) {
  return (left: number, right: number): number =>
    context.analysis.scarcity[left].openingContention -
      context.analysis.scarcity[right].openingContention ||
    context.openingsUsed[left] - context.openingsUsed[right] ||
    left - right
}

function abundantClosersFirst(context: OrderContext) {
  return (left: number, right: number): number =>
    context.analysis.scarcity[left].closingContention -
      context.analysis.scarcity[right].closingContention ||
    context.closingsUsed[left] - context.closingsUsed[right] ||
    left - right
}

/** How much damage closing on this day does to later thin opener pools. */
function blockingCost(context: OrderContext, employeeIndex: number): number {
  let cost = 0
  for (const laterDay of context.analysis.openDays) {
    if (!restConflict(context.normalised, context.dayIndex, laterDay)) continue
    const later = context.analysis.byDay.get(laterDay)
    if (!later?.openerPool.includes(employeeIndex)) continue
    cost += later.openerMargin <= 0 ? 4 : later.openerMargin === 1 ? 2 : 1
  }
  return cost
}

const FAMILIES: readonly Family[] = [
  {
    // The critical days claim their people while people remain to claim.
    name: "critical-days-first",
    dayOrder: (analysis) => analysis.criticalOrder,
    openerOrder: abundantOpenersFirst,
    closerOrder: abundantClosersFirst,
  },
  {
    // Same preferences, chronological walk: the rest chain reads forwards, so a
    // chronological pass sometimes finds a coherent week the critical order
    // fragments.
    name: "coverage-chronological",
    dayOrder: (analysis) => analysis.openDays,
    openerOrder: abundantOpenersFirst,
    closerOrder: abundantClosersFirst,
  },
  {
    // Contended openings are refused outright on days that have alternatives.
    name: "reserve-scarce-openings",
    dayOrder: (analysis) => analysis.criticalOrder,
    openerOrder: abundantOpenersFirst,
    closerOrder: abundantClosersFirst,
    reserveContendedOpenings: true,
  },
  {
    // Closings go to whoever blocks the fewest later openings.
    name: "minimise-tomorrow-blocking",
    dayOrder: (analysis) => analysis.openDays,
    openerOrder: abundantOpenersFirst,
    closerOrder: (context) => (left, right) =>
      blockingCost(context, left) - blockingCost(context, right) ||
      context.analysis.scarcity[left].closingContention -
        context.analysis.scarcity[right].closingContention ||
      left - right,
  },
  {
    // Days with the highest peak head-count first: they need the most bodies
    // simultaneously, so they are the least tolerant of leftovers.
    name: "peak-demand-first",
    dayOrder: (analysis) =>
      [...analysis.openDays].sort((left, right) => {
        const a = analysis.byDay.get(left)!
        const b = analysis.byDay.get(right)!
        return b.peakDemand - a.peakDemand || a.openerMargin - b.openerMargin || left - right
      }),
    openerOrder: abundantOpenersFirst,
    closerOrder: abundantClosersFirst,
  },
  {
    // The previous behaviour, kept as a SECONDARY family. It is the right
    // answer whenever coverage does not discriminate, and keeping it means the
    // rebuild can never be strictly worse than what it replaced.
    name: "fairness",
    dayOrder: (analysis) => analysis.openDays,
    openerOrder: (context) => (left, right) =>
      context.openingsUsed[left] - context.openingsUsed[right] || left - right,
    closerOrder: (context) => (left, right) =>
      context.closingsUsed[left] - context.closingsUsed[right] || left - right,
  },
]

export interface SkeletonSelection {
  readonly skeletons: readonly Skeleton[]
  readonly generated: number
  readonly uniqueSignatures: number
  readonly scores: readonly {
    readonly family: string
    readonly signature: string
    readonly score: readonly { readonly label: string; readonly value: number }[]
  }[]
}

/**
 * Build, deduplicate, score and rank the skeletons of one allocation.
 *
 * The generator contract is unchanged — callers still consume up to `limit`
 * skeletons — but the order is now by predictive score rather than by the
 * accident of a greedy walk.
 */
export function* generateSkeletons(
  normalised: NormalisedProblem,
  allocation: Allocation,
  limit: number
): Generator<Skeleton> {
  yield* selectSkeletons(normalised, allocation, limit).skeletons
}

export function selectSkeletons(
  normalised: NormalisedProblem,
  allocation: Allocation,
  limit: number
): SkeletonSelection {
  const analysis = analyseWeek(normalised, allocation)

  interface Candidate {
    readonly family: string
    readonly signature: string
    readonly roles: DayRoles[]
    readonly score: SkeletonScore
  }

  const bySignature = new Map<string, Candidate>()
  let generated = 0

  for (const family of FAMILIES) {
    for (const roles of walk(normalised, allocation, analysis, family, PER_FAMILY_LIMIT)) {
      generated++
      const signature = signatureOf(roles)
      // Deduplicated by ROLE signature, not by family: two families reaching the
      // same assignment describe the same schedule, and placing it twice would
      // spend a placement budget to rediscover the same answer.
      if (bySignature.has(signature)) continue
      bySignature.set(signature, {
        family: family.name,
        signature,
        roles,
        score: scoreSkeleton(normalised, allocation, analysis, roles),
      })
    }
  }

  const ranked = [...bySignature.values()].sort(
    (left, right) =>
      compareSkeletonScore(left.score, right.score) ||
      left.signature.localeCompare(right.signature)
  )

  const kept = ranked.slice(0, Math.max(0, limit))

  return {
    skeletons: kept.map((candidate, rank) =>
      materialise(normalised, allocation, candidate.roles, rank)
    ),
    generated,
    uniqueSignatures: bySignature.size,
    scores: kept.map((candidate) => ({
      family: candidate.family,
      signature: candidate.signature,
      score: describeSkeletonScore(candidate.score),
    })),
  }
}

/**
 * One family's constrained walk over the week.
 *
 * Days are visited in the family's order — which need NOT be chronological, so
 * the rest rule is checked symmetrically against every assignment already made,
 * in both directions, rather than against "yesterday".
 */
function walk(
  normalised: NormalisedProblem,
  allocation: Allocation,
  analysis: WeekAnalysis,
  family: Family,
  limit: number
): DayRoles[][] {
  const { employees, rules } = normalised
  const order = family.dayOrder(analysis)

  const openingsUsed = new Array<number>(employees.length).fill(0)
  const closingsUsed = new Array<number>(employees.length).fill(0)
  const opensOn: number[][] = employees.map(() => [])
  const closesOn: number[][] = employees.map(() => [])

  const chosen: DayRoles[] = []
  const found: DayRoles[][] = []

  const capOpenings = (index: number): number =>
    employees[index].maximumOpenings ?? Number.POSITIVE_INFINITY
  const capClosings = (index: number): number =>
    employees[index].maximumClosings ?? Number.POSITIVE_INFINITY

  /** Rest, checked against every assignment already made, both directions. */
  const mayOpen = (employeeIndex: number, dayIndex: number): boolean =>
    closesOn[employeeIndex].every((closeDay) => !restConflict(normalised, closeDay, dayIndex))
  const mayClose = (employeeIndex: number, dayIndex: number): boolean =>
    opensOn[employeeIndex].every((openDay) => !restConflict(normalised, dayIndex, openDay))

  function assign(position: number): void {
    if (found.length >= limit) return
    if (position === order.length) {
      found.push(chosen.map((entry) => ({ ...entry })))
      return
    }

    const dayIndex = order[position]
    const day = analysis.byDay.get(dayIndex)
    if (!day) {
      assign(position + 1)
      return
    }

    const context: OrderContext = {
      analysis,
      normalised,
      dayIndex,
      openingsUsed,
      closingsUsed,
    }

    const closerPool = [...day.closerPool].sort(family.closerOrder(context))
    const openerPoolBase = [...day.openerPool].sort(family.openerOrder(context))

    // A family may refuse to spend a contended opening on a day with slack —
    // but only while the day can still be served without it. Reserving into
    // infeasibility would be a heuristic overriding a rule.
    const openerPool =
      family.reserveContendedOpenings === true
        ? preferAbundant(openerPoolBase, analysis, day.openingDemand)
        : openerPoolBase

    const openerTarget = Math.min(day.openingDemand, openerPool.length)

    for (const closers of combinations(closerPool, Math.min(rules.exactClosingsPerDay, closerPool.length))) {
      if (closers.some((index) => closingsUsed[index] + 1 > capClosings(index))) continue
      if (closers.some((index) => !mayClose(index, dayIndex))) continue

      // Sizes descend: more openers is strictly better coverage, so the best
      // size is tried first, but a day is allowed to open short rather than
      // make the week infeasible.
      for (const openerCount of descending(rules.minimumOpeningsPerDay, openerTarget)) {
        for (const openers of combinations(openerPool, openerCount)) {
          if (openers.some((index) => openingsUsed[index] + 1 > capOpenings(index))) continue
          if (openers.some((index) => !mayOpen(index, dayIndex))) continue
          if (
            openers.some((index) => closers.includes(index)) &&
            !spansWholeDay(normalised, allocation, dayIndex, openers)
          ) {
            continue
          }

          for (const index of openers) {
            openingsUsed[index]++
            opensOn[index].push(dayIndex)
          }
          for (const index of closers) {
            closingsUsed[index]++
            closesOn[index].push(dayIndex)
          }
          chosen.push({ dayIndex, openers, closers })

          assign(position + 1)

          chosen.pop()
          for (const index of closers) {
            closingsUsed[index]--
            closesOn[index].pop()
          }
          for (const index of openers) {
            openingsUsed[index]--
            opensOn[index].pop()
          }
          if (found.length >= limit) return
        }
      }
    }
  }

  assign(0)
  return found
}

/**
 * Move contended candidates to the back while enough abundant ones remain.
 *
 * A preference, never a prohibition: if dropping the contended candidates would
 * leave the day unable to meet its demand, they stay in the pool. A reservation
 * that creates a hole today to protect one tomorrow has bought nothing.
 */
function preferAbundant(
  pool: readonly number[],
  analysis: WeekAnalysis,
  demand: number
): number[] {
  const abundant = pool.filter((index) => analysis.scarcity[index].openingContention <= 1)
  const contended = pool.filter((index) => analysis.scarcity[index].openingContention > 1)
  return abundant.length >= demand ? [...abundant, ...contended] : [...pool]
}

/** A total, stable identity for a role assignment. */
function signatureOf(roles: readonly DayRoles[]): string {
  return [...roles]
    .sort((left, right) => left.dayIndex - right.dayIndex)
    .map(
      (entry) =>
        `${entry.dayIndex}:${[...entry.openers].sort((a, b) => a - b).join(".")}/${[...entry.closers]
          .sort((a, b) => a - b)
          .join(".")}`
    )
    .join("|")
}

/** True when every named employee's allocation covers the full opening window. */
function spansWholeDay(
  normalised: NormalisedProblem,
  allocation: Allocation,
  dayIndex: number,
  employeeIndexes: readonly number[]
): boolean {
  const day = normalised.days[dayIndex]
  const span = (day.closesAtMinutes ?? 0) - (day.opensAtMinutes ?? 0)
  return employeeIndexes.every((index) => allocation.minutes[index][dayIndex] >= span)
}

function materialise(
  normalised: NormalisedProblem,
  allocation: Allocation,
  roles: readonly DayRoles[],
  rank: number
): Skeleton {
  const { employees, days, rules } = normalised
  const rolesByDay = new Map(roles.map((entry) => [entry.dayIndex, entry]))
  const entries: SkeletonEntry[] = []

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const dayRoles = rolesByDay.get(dayIndex)
    for (let employeeIndex = 0; employeeIndex < employees.length; employeeIndex++) {
      const minutes = allocation.minutes[employeeIndex][dayIndex]
      if (minutes <= 0) continue
      entries.push({
        employeeIndex,
        dayIndex,
        minutes,
        opens: dayRoles?.openers.includes(employeeIndex) ?? false,
        closes: dayRoles?.closers.includes(employeeIndex) ?? false,
        // A day longer than one uninterrupted stretch may allow is only legal
        // as a split, and only for someone allowed to split.
        requiresSplit:
          minutes > rules.maximumContinuousMinutes &&
          rules.splitShiftAllowed &&
          employees[employeeIndex].canSplitShift,
      })
    }
  }

  entries.sort(
    (left, right) => left.dayIndex - right.dayIndex || left.employeeIndex - right.employeeIndex
  )
  return { entries, rank }
}

/** `high` down to `low` inclusive; empty when the range is inverted. */
function descending(low: number, high: number): number[] {
  const values: number[] = []
  for (let value = high; value >= low; value--) values.push(value)
  return values
}

/**
 * All `size`-subsets of `pool`, in the pool's own order.
 *
 * The order is inherited rather than re-sorted, so a caller that handed in a
 * family-sorted pool gets family-ordered subsets — the first one yielded is the
 * family's preferred combination.
 */
function* combinations(pool: readonly number[], size: number): Generator<number[]> {
  if (size <= 0) {
    yield []
    return
  }
  if (pool.length < size) return

  const current: number[] = []
  function* pick(start: number): Generator<number[]> {
    if (current.length === size) {
      yield [...current]
      return
    }
    for (let index = start; index < pool.length; index++) {
      if (pool.length - index < size - current.length) return
      current.push(pool[index])
      yield* pick(index + 1)
      current.pop()
    }
  }
  yield* pick(0)
}
