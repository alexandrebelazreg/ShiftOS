/**
 * Atomic-interval coverage — the ONE place this codebase decides how many
 * people are actually present during a window.
 *
 * The bug this file fixes: counting only the shifts that individually span an
 * ENTIRE demand window ("shift.start <= window.start && shift.end >=
 * window.end") systematically under-counts true concurrent presence whenever
 * two or more staggered shifts jointly cover the window without any single one
 * spanning it alone. Three employees on 06:00–12:30, 10:00–14:00, 12:15–17:45
 * genuinely keep at least 2 people on the floor throughout 12:00–13:00 — the
 * full-span check reports 1.
 *
 * The correct question is never "does one shift span the window" but "at
 * every instant of the window, how many shifts are present" — which is a
 * concurrency problem, not a containment problem. This module answers it by
 * splitting the window into the ATOMIC sub-intervals formed by its own
 * boundaries and every covering interval's boundaries (clipped to the
 * window): inside one atomic piece nobody's presence can change, because a
 * change is exactly what a boundary marks. Presence is then a plain count per
 * piece, and the window's headcount is a minimum or a sum over those pieces —
 * never a per-shift containment test.
 *
 * Used identically by the V2 coverage calculator, the V3 validator and the
 * board's daily table, so the three cannot silently disagree. The CP-SAT
 * model (Python, `cpsat_model.py`) cannot import this file, so it reimplements
 * the same reasoning — see the note there — and a cross-language test with
 * the same fixture pins the two to the same numbers.
 */

export interface CoverageInterval {
  readonly startMinutes: number
  readonly endMinutes: number
}

/** One atomic piece of a window: nobody's presence changes within it. */
export interface AtomicCoverageSegment {
  readonly startMinutes: number
  readonly endMinutes: number
  /** How many of the given intervals fully contain this piece. */
  readonly present: number
}

/**
 * Split `window` into its atomic pieces and count concurrent presence in
 * each.
 *
 * An interval outside the window, or touching it only at a single point,
 * contributes nothing — only the part that OVERLAPS the window can move a
 * breakpoint or count toward presence. An interval "fully contains" an atomic
 * piece under the same rule the callers used before this fix — start at or
 * before the piece, end at or after it — which is exactly what makes a piece
 * atomic: no covering interval can start or end strictly inside one.
 */
export function atomicCoverage(
  window: CoverageInterval,
  intervals: readonly CoverageInterval[]
): readonly AtomicCoverageSegment[] {
  if (window.endMinutes <= window.startMinutes) return []

  const breakpoints = new Set<number>([window.startMinutes, window.endMinutes])
  for (const interval of intervals) {
    const start = Math.max(window.startMinutes, interval.startMinutes)
    const end = Math.min(window.endMinutes, interval.endMinutes)
    if (start < end) {
      breakpoints.add(start)
      breakpoints.add(end)
    }
  }

  const sorted = [...breakpoints].sort((left, right) => left - right)
  const segments: AtomicCoverageSegment[] = []
  for (let index = 0; index < sorted.length - 1; index++) {
    const startMinutes = sorted[index]
    const endMinutes = sorted[index + 1]
    if (endMinutes <= startMinutes) continue
    const present = intervals.filter(
      (interval) => interval.startMinutes <= startMinutes && interval.endMinutes >= endMinutes
    ).length
    segments.push({ startMinutes, endMinutes, present })
  }
  return segments
}

/**
 * The worst concurrent presence anywhere in the window — the number that
 * decides whether a headcount requirement was met THROUGHOUT it, not merely
 * on average or at its start.
 *
 * Zero on an empty window or on a window nothing covers: a window with no
 * atomic pieces has nothing present, by construction, not "unknown."
 */
export function minimumConcurrentPresence(
  window: CoverageInterval,
  intervals: readonly CoverageInterval[]
): number {
  const segments = atomicCoverage(window, intervals)
  if (segments.length === 0) return 0
  return Math.min(...segments.map((segment) => segment.present))
}

/**
 * Employee-minutes short of `required`, summed atomically.
 *
 * NOT `(required - minimumConcurrentPresence) * windowSpan`: that formula
 * charges the WHOLE window for a shortfall that may only last one atomic
 * piece. Every piece pays only for its own gap, at its own width, so a window
 * short by one person for 15 of its 60 minutes costs 15 employee-minutes, not
 * 60.
 */
export function coverageDeficitMinutes(
  window: CoverageInterval,
  intervals: readonly CoverageInterval[],
  required: number
): number {
  return atomicCoverage(window, intervals).reduce(
    (sum, segment) =>
      sum + Math.max(0, required - segment.present) * (segment.endMinutes - segment.startMinutes),
    0
  )
}
