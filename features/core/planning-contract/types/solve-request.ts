import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import type { PlanningRegenerationRequest } from "@/features/core/planning-contract/types/regeneration"

/**
 * Everything an engine is given to produce a schedule — the WHOLE input, in one
 * value.
 *
 * A solver that receives only a `PlanningProblemV3` cannot honour a lock or a
 * manual move, because neither is expressible in the problem: the problem says
 * what is legal, not what the manager already decided. Passing the problem
 * alone therefore forces every caller to invent its own side channel for local
 * work, and makes "did the engine keep my pinned shifts?" a question no one can
 * answer from the types. This request closes that hole: the problem, the local
 * edits, the locks and the regeneration options travel together or not at all.
 *
 * Deliberately only two fields. Timeouts, state ceilings and cancellation
 * belong to the ADAPTER that runs a particular engine — a CP-SAT deadline means
 * nothing to a DFS prototype — and putting them here would leak engine
 * vocabulary back into the one shape the UI is allowed to know.
 */
export interface SolvePlanningRequest {
  readonly problem: PlanningProblemV3
  /**
   * Absent on a first generation: there is no local work to preserve yet.
   * Present on every regeneration, even when it carries neither lock nor edit,
   * because `minimizeOtherChanges` is an intent on its own.
   */
  readonly regeneration?: PlanningRegenerationRequest
}

/** What the request actually asks an engine to preserve. */
export interface RequestedPreservations {
  /** At least one lock exists AND the manager asked to keep them. */
  readonly locks: boolean
  /** At least one manual edit exists AND the manager asked to keep them. */
  readonly manualEdits: boolean
  /** The manager asked for the untouched rest of the week to stay put. */
  readonly minimizeOtherChanges: boolean
  /** True when the engine is free: nothing at all has to be preserved. */
  readonly none: boolean
}

/**
 * Read the request's demands once, so no adapter has to re-derive them.
 *
 * A flag alone is not a demand: `preserveLockedShifts` with an empty lock set
 * asks for nothing, and an engine that reported "locks not respected" for it
 * would be crying wolf. Both halves are required here, which is what makes
 * `SolvePlanningMetadata.respectedLocks` mean something.
 */
export function requestedPreservations(request: SolvePlanningRequest): RequestedPreservations {
  const regeneration = request.regeneration
  const locks =
    regeneration !== undefined &&
    regeneration.preserveLockedShifts &&
    regeneration.lockedShiftIds.length > 0
  const manualEdits =
    regeneration !== undefined &&
    regeneration.preserveManualEdits &&
    regeneration.editedShifts.length > 0
  const minimizeOtherChanges = regeneration?.minimizeOtherChanges === true

  return {
    locks,
    manualEdits,
    minimizeOtherChanges,
    none: !locks && !manualEdits && !minimizeOtherChanges,
  }
}
