import type {
  ReducedCandidate,
  Skeleton,
} from "@/features/core/planning-v3/solver-decomposed/types"
import type { NormalisedProblem } from "@/features/core/planning-v3/solver-decomposed/diagnostics/normalise"

/**
 * Phase 4 — the reduced candidate space.
 *
 * The engine this replaces enumerates EVERY start crossed with EVERY duration,
 * for every employee and every day: on the Drive week that is roughly twenty
 * thousand shifts, the overwhelming majority of which contradict the contracts
 * before anything has been placed. The decomposition removes an entire
 * dimension — after Phase 2 the duration is DECIDED, so only the start is free.
 * On the same week that turns tens of thousands of candidates into hundreds.
 *
 * The skeleton removes most of what is left. A designated opener has exactly
 * one legal start. A designated closer has exactly one. Someone designated
 * neither is FORBIDDEN from landing on either boundary, which is the two-sided
 * reading Phase 3 promised: without it, a non-opener drifting onto the opening
 * minute would silently create a second opening and break a weekly cap that was
 * already settled.
 *
 * Every bound below is read from the problem — `minimumShiftMinutes`,
 * `maximumSplitMinutes`, the employee's own window. The one value this module
 * may supply itself is the split floor, and only because `PlanningRulesV3`
 * gained the field this sprint with no sector populating it yet; when it is
 * defaulted, Phase 1 records the assumption so the run says so out loud.
 */

export interface CandidateSpace {
  /** `byEntry[skeletonEntryIndex]` — the shapes that one worked day may take. */
  readonly byEntry: readonly (readonly ReducedCandidate[])[]
  readonly total: number
  /** Entries for which NO legal shape exists. A non-empty list kills the skeleton. */
  readonly impossible: readonly { readonly employeeIndex: number; readonly dayIndex: number }[]
}

export function generateReducedCandidates(
  normalised: NormalisedProblem,
  skeleton: Skeleton
): CandidateSpace {
  const byEntry: ReducedCandidate[][] = []
  const impossible: { employeeIndex: number; dayIndex: number }[] = []
  let total = 0

  const windows = tightenWindowsForRest(normalised, skeleton)

  for (const entry of skeleton.entries) {
    const candidates = entry.requiresSplit
      ? splitCandidates(normalised, entry, windows)
      : continuousCandidates(normalised, entry, windows)

    if (candidates.length === 0) {
      impossible.push({ employeeIndex: entry.employeeIndex, dayIndex: entry.dayIndex })
    }
    byEntry.push(candidates)
    total += candidates.length
  }

  return { byEntry, total, impossible }
}

/** The bounds one worked day must respect, after the rest rule is propagated. */
export interface TightWindow {
  readonly earliestStartMinutes: number
  readonly latestEndMinutes: number
}

/**
 * Propagate the rest rule through the skeleton, BEFORE generating anything.
 *
 * The rest rule couples an evening to the next morning, and the skeleton has
 * already fixed the only two times that are known exactly: a designated closer
 * ends at closing, a designated opener starts at opening. Both facts can be
 * pushed into their neighbour's window:
 *
 * - someone who CLOSES a day cannot start the next worked day before
 *   `close + rest`, so their next morning is bounded from below;
 * - someone who OPENS a day cannot have ended the previous worked day after
 *   `open − rest`, so their previous evening is bounded from above.
 *
 * Doing this here rather than rejecting violations later is the difference
 * between an engine that works and one that does not. Measured on the Drive
 * week before this existed, the weekly walk rejected 57 600 of 57 840 day
 * patterns on the rest rule alone and never reached the third day: every
 * pattern kept for a day was chosen for its coverage, and the best-covering
 * patterns of two adjacent days are exactly the ones that clash. Pushing the
 * bound into the window means the clashing candidates are never generated.
 *
 * Only EXACT facts are propagated. A non-closer's end is not yet decided, so
 * nothing is assumed about it — the weekly walk still checks the rule in full,
 * and this function only spares it the cases that were already decided.
 */
export function tightenWindowsForRest(
  normalised: NormalisedProblem,
  skeleton: Skeleton
): TightWindow[][] {
  const { employees, days, entries: availability, rules } = normalised
  const rest = rules.minimumRestMinutes

  const windows: TightWindow[][] = employees.map((_employee, employeeIndex) =>
    days.map((_day, dayIndex) => ({
      earliestStartMinutes: availability[employeeIndex][dayIndex].earliestStartMinutes,
      latestEndMinutes: availability[employeeIndex][dayIndex].latestEndMinutes,
    }))
  )

  // Worked days per employee, in calendar order — the rule reads consecutive
  // WORKED days, not adjacent calendar days.
  const workedDays: number[][] = employees.map(() => [])
  const roleByKey = new Map<string, { opens: boolean; closes: boolean }>()
  for (const entry of skeleton.entries) {
    workedDays[entry.employeeIndex].push(entry.dayIndex)
    roleByKey.set(`${entry.employeeIndex}|${entry.dayIndex}`, {
      opens: entry.opens,
      closes: entry.closes,
    })
  }

  for (let employeeIndex = 0; employeeIndex < employees.length; employeeIndex++) {
    const worked = workedDays[employeeIndex].sort((left, right) => left - right)

    for (let index = 1; index < worked.length; index++) {
      const previous = worked[index - 1]
      const current = worked[index]
      const gap = (current - previous) * 1_440

      const previousRole = roleByKey.get(`${employeeIndex}|${previous}`)
      const currentRole = roleByKey.get(`${employeeIndex}|${current}`)

      if (previousRole?.closes === true) {
        const closesAt = days[previous].closesAtMinutes ?? 0
        const floor = closesAt + rest - gap
        if (floor > windows[employeeIndex][current].earliestStartMinutes) {
          windows[employeeIndex][current] = {
            ...windows[employeeIndex][current],
            earliestStartMinutes: floor,
          }
        }
      }

      if (currentRole?.opens === true) {
        const opensAt = days[current].opensAtMinutes ?? 0
        const ceiling = opensAt + gap - rest
        if (ceiling < windows[employeeIndex][previous].latestEndMinutes) {
          windows[employeeIndex][previous] = {
            ...windows[employeeIndex][previous],
            latestEndMinutes: ceiling,
          }
        }
      }
    }
  }

  return windows
}

/** One uninterrupted stretch of exactly the allocated minutes. */
function continuousCandidates(
  normalised: NormalisedProblem,
  entry: Skeleton["entries"][number],
  windows: readonly (readonly TightWindow[])[]
): ReducedCandidate[] {
  const { days, rules } = normalised
  const day = days[entry.dayIndex]
  const window = windows[entry.employeeIndex][entry.dayIndex]
  const step = rules.timeStepMinutes
  const opensAt = day.opensAtMinutes ?? 0
  const closesAt = day.closesAtMinutes ?? 0
  const minutes = entry.minutes

  if (minutes > rules.maximumContinuousMinutes) return []

  const starts: number[] = []
  if (entry.opens) {
    starts.push(opensAt)
  } else if (entry.closes) {
    starts.push(closesAt - minutes)
  } else {
    const first = ceilToStep(window.earliestStartMinutes, step)
    const last = window.latestEndMinutes - minutes
    for (let start = first; start <= last; start += step) starts.push(start)
  }

  const candidates: ReducedCandidate[] = []
  for (const start of starts) {
    const end = start + minutes
    if (start < window.earliestStartMinutes || end > window.latestEndMinutes) continue

    const opens = start === opensAt
    const closes = end === closesAt
    // The skeleton is binding both ways: a role held is required, a role not
    // held is forbidden.
    if (opens !== entry.opens) continue
    if (closes !== entry.closes) continue

    candidates.push({
      employeeIndex: entry.employeeIndex,
      dayIndex: entry.dayIndex,
      segments: [{ startMinutes: start, endMinutes: end }],
      startMinutes: start,
      endMinutes: end,
      minutes,
      opens,
      closes,
    })
  }

  return sortCandidates(candidates)
}

/**
 * Two stretches separated by one break.
 *
 * Only ever produced for a day the skeleton marked as requiring a split — that
 * is, one whose allocated minutes exceed what a single uninterrupted stretch
 * may hold, for an employee the problem allows to split. A split is never
 * invented to improve coverage; it is a consequence of a duration that cannot
 * be worked in one go.
 *
 * Both stretches obey `minimumShiftMinutes`: a "split" whose second half is
 * forty minutes is not a split shift, it is a shift with an errand in it.
 */
function splitCandidates(
  normalised: NormalisedProblem,
  entry: Skeleton["entries"][number],
  windows: readonly (readonly TightWindow[])[]
): ReducedCandidate[] {
  const { days, rules } = normalised
  const day = days[entry.dayIndex]
  const window = windows[entry.employeeIndex][entry.dayIndex]
  const step = rules.timeStepMinutes
  const opensAt = day.opensAtMinutes ?? 0
  const closesAt = day.closesAtMinutes ?? 0
  const minutes = entry.minutes

  if (!rules.splitShiftAllowed) return []
  if (rules.maximumSplitsPerDay < 1) return []

  const minSegment = Math.max(rules.minimumShiftMinutes, step)
  const maxSegment = rules.maximumContinuousMinutes
  const minGap = ceilToStep(Math.max(rules.minimumSplitMinutes, step), step)
  const maxGap = rules.maximumSplitMinutes

  if (maxGap < minGap) return []

  const candidates: ReducedCandidate[] = []
  const firstStartLow = ceilToStep(window.earliestStartMinutes, step)

  for (let firstMinutes = minSegment; firstMinutes <= Math.min(maxSegment, minutes - minSegment); firstMinutes += step) {
    const secondMinutes = minutes - firstMinutes
    if (secondMinutes < minSegment || secondMinutes > maxSegment) continue

    for (let gap = minGap; gap <= maxGap; gap += step) {
      const span = firstMinutes + gap + secondMinutes

      for (let start = firstStartLow; start + span <= window.latestEndMinutes; start += step) {
        const firstEnd = start + firstMinutes
        const secondStart = firstEnd + gap
        const secondEnd = secondStart + secondMinutes

        const opens = start === opensAt
        const closes = secondEnd === closesAt
        if (opens !== entry.opens) continue
        if (closes !== entry.closes) continue

        candidates.push({
          employeeIndex: entry.employeeIndex,
          dayIndex: entry.dayIndex,
          segments: [
            { startMinutes: start, endMinutes: firstEnd },
            { startMinutes: secondStart, endMinutes: secondEnd },
          ],
          startMinutes: start,
          endMinutes: secondEnd,
          minutes,
          opens,
          closes,
        })
      }
    }
  }

  return sortCandidates(candidates)
}

/**
 * A total order over candidates.
 *
 * Load-bearing twice over: it makes the whole search reproducible, and it puts
 * the SIMPLEST shapes first — earlier starts, fewer segments — so a placement
 * that takes the first workable option lands on a plain schedule rather than a
 * baroque one that happens to score identically.
 */
function sortCandidates(candidates: ReducedCandidate[]): ReducedCandidate[] {
  return candidates.sort(
    (left, right) =>
      left.segments.length - right.segments.length ||
      left.startMinutes - right.startMinutes ||
      left.endMinutes - right.endMinutes ||
      (left.segments[0]?.endMinutes ?? 0) - (right.segments[0]?.endMinutes ?? 0)
  )
}

function ceilToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step
}
