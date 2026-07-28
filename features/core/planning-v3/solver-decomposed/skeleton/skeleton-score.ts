import type { Allocation } from "@/features/core/planning-v3/solver-decomposed/types"
import type { NormalisedProblem } from "@/features/core/planning-v3/solver-decomposed/diagnostics/normalise"
import type { WeekAnalysis } from "@/features/core/planning-v3/solver-decomposed/skeleton/week-analysis"
import { restConflict } from "@/features/core/planning-v3/solver-decomposed/skeleton/week-analysis"

/**
 * Step 3 — what a skeleton is worth, judged BEFORE the exact placement runs.
 *
 * The whole point of this file is one measurement: the DEFICIT A SKELETON HAS
 * ALREADY MADE UNAVOIDABLE. Not an estimate of how a placement might go — a
 * lower bound that no placement can beat.
 *
 * It rests on a presence profile that is a genuine UPPER BOUND on how many
 * people can be on the floor at each instant:
 *
 * - a designated opener starts exactly at opening, so across the opening cell
 *   the people present are precisely the openers — no more, and nobody else may
 *   join them, because a non-opener is forbidden from starting there;
 * - a designated closer ends exactly at closing, symmetrically;
 * - anyone else could be anywhere inside their own window, so they are counted
 *   as present everywhere in it.
 *
 * The third rule OVER-counts on purpose. Over-counting presence under-counts
 * the deficit, which keeps the result a sound lower bound: a skeleton this
 * function says will lose 135 minutes will lose at least that. It never
 * punishes a skeleton for a shortfall a clever placement could have avoided.
 *
 * That soundness is what lets the score outrank fairness without risk. A
 * skeleton scoring zero here may still place badly; a skeleton scoring three
 * guaranteed slots cannot place well, and there is no reason to spend a
 * placement budget discovering that.
 *
 * The score is a TUPLE, in the priority order the brief fixes: structural
 * violations, guaranteed slots, guaranteed minutes, scarce-resource waste,
 * chain fragility, and only then fairness. Never a weighted sum — a weighted
 * sum lets a fairness gain pay for a guaranteed hole.
 */

export const SKELETON_SCORE_COMPONENTS = [
  /** A day left without the openings or closings the rules require at all. */
  "structural-violations",
  /** Demand slots whose shortfall is already unavoidable. */
  "guaranteed-under-covered-slots",
  /** Employee-minutes already unavoidable, summed atomically. */
  "guaranteed-deficit-minutes",
  /** Contended capability spent on a day that had alternatives. */
  "scarce-resource-waste",
  /** Assignments that will block a later day's thin pool. */
  "chain-fragility",
  /** Spread between the busiest and quietest holder of each duty. */
  "fairness-spread",
] as const

export type SkeletonScoreComponent = (typeof SKELETON_SCORE_COMPONENTS)[number]
export type SkeletonScore = number[]

export interface DayRoles {
  readonly dayIndex: number
  readonly openers: readonly number[]
  readonly closers: readonly number[]
}

/** Negative when `left` is strictly better, positive when worse, 0 when equal. */
export function compareSkeletonScore(
  left: readonly number[],
  right: readonly number[]
): number {
  for (let index = 0; index < SKELETON_SCORE_COMPONENTS.length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function describeSkeletonScore(
  score: readonly number[]
): readonly { readonly label: string; readonly value: number }[] {
  return SKELETON_SCORE_COMPONENTS.map((label, index) => ({ label, value: score[index] ?? 0 }))
}

export function scoreSkeleton(
  normalised: NormalisedProblem,
  allocation: Allocation,
  analysis: WeekAnalysis,
  roles: readonly DayRoles[]
): SkeletonScore {
  const { employees, rules } = normalised
  const step = rules.timeStepMinutes

  let structural = 0
  let guaranteedSlots = 0
  let guaranteedMinutes = 0

  for (const dayRoles of roles) {
    const day = analysis.byDay.get(dayRoles.dayIndex)
    if (!day) continue

    // A day that cannot field the openings or closings the rules demand is not
    // merely worse, it is malformed as a plan.
    if (dayRoles.openers.length < Math.min(rules.minimumOpeningsPerDay, day.openerPool.length)) {
      structural++
    }
    if (dayRoles.closers.length !== Math.min(rules.exactClosingsPerDay, day.closerPool.length)) {
      structural++
    }

    const profile = maxPresenceProfile(normalised, allocation, dayRoles)

    for (const slot of normalised.slotsByDay[dayRoles.dayIndex]) {
      const firstCell = Math.floor((slot.startMinutes - day.opensAtMinutes) / step)
      const lastCell = Math.floor((slot.endMinutes - day.opensAtMinutes) / step) - 1

      let worst = Number.POSITIVE_INFINITY
      let missing = 0
      for (let cell = firstCell; cell <= lastCell; cell++) {
        const present = profile[cell] ?? Number.POSITIVE_INFINITY
        if (present < worst) worst = present
        if (present < slot.requiredEmployees) missing += (slot.requiredEmployees - present) * step
      }

      if (worst < slot.requiredEmployees) {
        guaranteedSlots++
        guaranteedMinutes += missing
      }
    }
  }

  // ── Scarce capability spent where alternatives existed ──────────────────
  //
  // The failure this component exists to stop: a capped employee's only opening
  // handed to a day with three candidates for two seats, leaving a day with one
  // candidate for two seats unable to be served at all. The penalty is the
  // day's slack — spending a contended capability on a comfortable day costs
  // more than spending it on a tight one.
  let waste = 0
  for (const dayRoles of roles) {
    const day = analysis.byDay.get(dayRoles.dayIndex)
    if (!day) continue

    for (const employeeIndex of dayRoles.openers) {
      const scarcity = analysis.scarcity[employeeIndex]
      if (scarcity.openingContention <= 1) continue
      waste += Math.max(0, day.openerMargin) * Math.round(scarcity.openingContention)
    }
    for (const employeeIndex of dayRoles.closers) {
      const scarcity = analysis.scarcity[employeeIndex]
      if (scarcity.closingContention <= 1) continue
      waste += Math.max(0, day.closerMargin) * Math.round(scarcity.closingContention)
    }
  }

  // ── Chain fragility ─────────────────────────────────────────────────────
  //
  // Closing tonight forbids opening tomorrow. That is free when tomorrow has
  // openers to spare and expensive when it does not, so the penalty is weighted
  // by how thin tomorrow's pool already is.
  let fragility = 0
  for (const dayRoles of roles) {
    for (const employeeIndex of dayRoles.closers) {
      for (const laterDay of analysis.openDays) {
        if (!restConflict(normalised, dayRoles.dayIndex, laterDay)) continue
        const later = analysis.byDay.get(laterDay)
        if (!later) continue
        if (!later.openerPool.includes(employeeIndex)) continue
        // Removing this employee from a pool that was already at or below its
        // demand is what creates tomorrow's guaranteed hole.
        fragility += later.openerMargin <= 0 ? 4 : later.openerMargin === 1 ? 2 : 1
      }
    }
  }

  // ── Fairness, last ──────────────────────────────────────────────────────
  const openings = new Array<number>(employees.length).fill(0)
  const closings = new Array<number>(employees.length).fill(0)
  for (const dayRoles of roles) {
    for (const index of dayRoles.openers) openings[index]++
    for (const index of dayRoles.closers) closings[index]++
  }

  return [
    structural,
    guaranteedSlots,
    guaranteedMinutes,
    waste,
    fragility,
    spread(openings) + spread(closings),
  ]
}

/**
 * The most people who can be on the floor at each cell of one day.
 *
 * Sound by construction — see the module note. Cell `c` spans
 * `[opensAt + c*step, opensAt + (c+1)*step)`.
 */
export function maxPresenceProfile(
  normalised: NormalisedProblem,
  allocation: Allocation,
  dayRoles: DayRoles
): number[] {
  const { days, entries, rules, slotsByDay } = normalised
  const day = days[dayRoles.dayIndex]
  const step = rules.timeStepMinutes
  const opensAt = day.opensAtMinutes ?? 0
  const closesAt = day.closesAtMinutes ?? 0

  // The grid has to span every demand slot, not merely the opening hours: a
  // slot reaching beyond them would otherwise be measured against cells that
  // do not exist.
  let end = closesAt
  for (const slot of slotsByDay[dayRoles.dayIndex]) end = Math.max(end, slot.endMinutes)
  const cellCount = Math.max(0, Math.ceil((end - opensAt) / step))
  const profile = new Array<number>(cellCount).fill(0)

  const cover = (from: number, to: number): void => {
    const first = Math.max(0, Math.floor((from - opensAt) / step))
    const last = Math.min(cellCount - 1, Math.ceil((to - opensAt) / step) - 1)
    for (let cell = first; cell <= last; cell++) profile[cell]++
  }

  for (let employeeIndex = 0; employeeIndex < normalised.employees.length; employeeIndex++) {
    const minutes = allocation.minutes[employeeIndex][dayRoles.dayIndex]
    if (minutes <= 0) continue

    const entry = entries[employeeIndex][dayRoles.dayIndex]

    if (dayRoles.openers.includes(employeeIndex)) {
      // Pinned: an opener is present exactly from opening for their duration,
      // and nowhere else. This is the bound that makes the whole score work.
      cover(opensAt, opensAt + minutes)
      continue
    }
    if (dayRoles.closers.includes(employeeIndex)) {
      cover(closesAt - minutes, closesAt)
      continue
    }

    // Free to start anywhere in their window, so possibly present anywhere in
    // it — EXCEPT on the two boundary cells.
    //
    // The candidate generator enforces the skeleton both ways: a role held is
    // required, a role not held is forbidden. So at the opening cell the people
    // on the floor are exactly the designated openers, and at the closing cell
    // exactly the designated closers. Nobody else can be there, whatever the
    // placement does with the rest of the day.
    //
    // Counting them there anyway is not a loose bound, it is a FALSE one in the
    // only place where the skeleton alone decides coverage. Measured on the
    // sibling Python engine, which had the identical defect: a Saturday whose
    // demand wanted four openers scored the same with three, because the
    // missing fourth was counted present at opening regardless — and that slot
    // was then lost in every schedule the engine built, with nothing in any
    // diagnostic able to say why.
    //
    // Excluding a cell they cannot occupy removes impossible presence, so this
    // stays an UPPER bound on presence and the score stays a LOWER bound on the
    // deficit. The two guards keep it exact when a window genuinely reaches
    // past a boundary: someone whose window starts before opening could hold
    // the opening cell without starting on it, and symmetrically at closing.
    //
    // MEASURED HERE, AND IT CHANGED NOTHING. Drive stayed at 4 slots / 195
    // minutes, Accueil at zero, the reduced-roster week at 25 / 2115. Unlike
    // the Python engine, this one still allocates BEFORE choosing roles, so its
    // skeletons are ranked against an allocation that was picked blind and the
    // ranking is not what limits it. The fix is kept because the old bound was
    // false and a false bound is worth removing on its own — not because it
    // bought anything yet.
    let earliest = entry.earliestStartMinutes
    let latest = entry.latestEndMinutes
    if (earliest >= opensAt) earliest = Math.max(earliest, opensAt + step)
    if (latest <= closesAt) latest = Math.min(latest, closesAt - step)
    cover(earliest, latest)
  }

  return profile
}

function spread(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.max(...values) - Math.min(...values)
}
