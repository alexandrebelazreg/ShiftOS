import type { CoverageRequirement } from "@/features/core/demand-engine"

/**
 * Order coverage requirements chronologically and deterministically: by date,
 * then window start time, then `endDayOffset`, then id as a final tie-break.
 * Returns a new array — the input is never mutated.
 *
 * Deterministic ordering is what makes the whole generation reproducible: the
 * sequential strategy processes windows in exactly this order every run.
 */
export function inChronologicalOrder(
  requirements: readonly CoverageRequirement[]
): readonly CoverageRequirement[] {
  return [...requirements].sort((a, b) => {
    const dateDiff = compare(a.window.date, b.window.date)
    if (dateDiff !== 0) return dateDiff

    const startDiff = compare(a.window.start, b.window.start)
    if (startDiff !== 0) return startDiff

    const offsetDiff = (a.window.endDayOffset ?? 0) - (b.window.endDayOffset ?? 0)
    if (offsetDiff !== 0) return offsetDiff

    return compare(a.id, b.id)
  })
}

function compare(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}
