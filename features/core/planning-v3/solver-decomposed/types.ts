import type { EmployeeId, IsoDate } from "@/features/core/models"

/**
 * Internal vocabulary of the decomposed engine.
 *
 * Nothing here leaves the module: `solve.ts` translates every one of these into
 * the shared `PlanningSolverResultV3`. Keeping the internal model separate is
 * what lets the pipeline carry the intermediate facts each phase needs — an
 * allocation matrix, a weekly skeleton — without inventing a second public
 * solution shape the rest of the application could start depending on.
 */

/** The phases, in the order `solve` runs them. Used for the timing breakdown. */
export const DECOMPOSED_PHASES = [
  "normalisation",
  "allocation",
  "skeleton",
  "candidates",
  "placement",
  "repair",
] as const
export type DecomposedPhase = (typeof DECOMPOSED_PHASES)[number]

export interface DecomposedOptions {
  /** Wall-clock budget for the whole pipeline. Reaching it forbids nothing but the search. */
  readonly timeoutMs?: number
  /** How many distinct minute allocations may be tried before giving up. */
  readonly maximumAllocations?: number
  /** Ceiling on placement search nodes, summed across allocations. */
  readonly maximumPlacementNodes?: number
  /** Phase 6 is optional by design; on by default. */
  readonly repairEnabled?: boolean
  /** Cooperative cancellation, polled between nodes. */
  readonly signal?: { readonly aborted: boolean }
  /**
   * The split floor to assume when the problem declares none.
   *
   * An ASSUMPTION, not a rule: it is recorded in the diagnostics so a reader
   * can tell a configured 45 minutes from a defaulted one. `PlanningRulesV3`
   * gained `minimumSplitMinutes` this sprint but no sector populates it yet.
   */
  readonly assumedMinimumSplitMinutes?: number
}

export interface DecomposedResolvedOptions {
  readonly timeoutMs: number
  readonly maximumAllocations: number
  readonly maximumPlacementNodes: number
  readonly repairEnabled: boolean
  readonly signal: { readonly aborted: boolean } | null
  readonly assumedMinimumSplitMinutes: number
}

/**
 * The effective rules the engine searched under.
 *
 * Separate from `PlanningRulesV3` because some of them were ASSUMED rather than
 * read. A run that silently invented a 45-minute split floor and a run that
 * read one from the sector produce the same schedule and are not the same
 * event; the difference belongs in the diagnostics, so it has to be a value.
 */
export interface EffectiveRules {
  readonly timeStepMinutes: number
  readonly minimumShiftMinutes: number
  readonly maximumShiftMinutes: number
  readonly minimumRestMinutes: number
  readonly splitShiftAllowed: boolean
  readonly minimumSplitMinutes: number
  readonly maximumSplitMinutes: number
  readonly maximumContinuousMinutes: number
  readonly maximumSplitsPerDay: number
  readonly minimumOpeningsPerDay: number
  readonly exactClosingsPerDay: number
  /** Which of the above were defaulted rather than read from the problem. */
  readonly assumed: readonly string[]
}

/** Minutes one employee owes on one date. Zero means a rest day. */
export interface AllocationCell {
  readonly employeeIndex: number
  readonly dayIndex: number
  readonly minutes: number
}

/** One complete answer to "how many minutes does everyone work each day". */
export interface Allocation {
  /** `minutes[employeeIndex][dayIndex]`, always a multiple of the time step. */
  readonly minutes: readonly (readonly number[])[]
  /** Rank in the preference order the generator emitted it in. Zero is best. */
  readonly rank: number
}

/** What one employee does on one day, before any exact hour is chosen. */
export interface SkeletonEntry {
  readonly employeeIndex: number
  readonly dayIndex: number
  readonly minutes: number
  readonly opens: boolean
  readonly closes: boolean
  /** True when the allocated minutes cannot fit in one continuous stretch. */
  readonly requiresSplit: boolean
}

export interface Skeleton {
  readonly entries: readonly SkeletonEntry[]
  readonly rank: number
}

/** One placeable shape for one employee on one day. */
export interface ReducedCandidate {
  readonly employeeIndex: number
  readonly dayIndex: number
  readonly segments: readonly { readonly startMinutes: number; readonly endMinutes: number }[]
  readonly startMinutes: number
  readonly endMinutes: number
  readonly minutes: number
  readonly opens: boolean
  readonly closes: boolean
}

export interface PlacedShift {
  readonly employeeId: EmployeeId
  readonly date: IsoDate
  readonly segments: readonly { readonly startMinutes: number; readonly endMinutes: number }[]
}

/** Why the pipeline stopped. Mirrors the shared vocabulary, one to one. */
export type DecomposedStopCause =
  | "exhausted"
  | "timeout"
  | "state-limit"
  | "cancelled"
  | "not-started"

export interface DecomposedCounters {
  readonly allocationsTested: number
  readonly skeletonsTested: number
  readonly candidatesGenerated: number
  readonly placementNodes: number
  readonly repairsTested: number
  readonly repairsApplied: number
}

export interface DecomposedPhaseTiming {
  readonly phase: DecomposedPhase
  readonly durationMs: number
}
