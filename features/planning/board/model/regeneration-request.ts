import type {
  PlanningRegenerationRequest,
  RegeneratedShiftEdit,
} from "@/features/core/planning-contract/types/regeneration"
import type { ShiftEditState } from "@/features/planning/board/model/shift-edit-state"

/**
 * The manager's intent for a future regeneration, captured as plain data.
 *
 * This is the ONE thing this sprint actually delivers: a pure, engine-neutral
 * contract that says "here is what I want preserved, and here is my current
 * local work". It imports no solver — not V2, not V3, not CP-SAT — on purpose.
 * When the V3 backend exists, it will take a `PlanningProblemV3` plus one of
 * these and hand the pair to CP-SAT; nothing here needs to change for that.
 *
 * The two request TYPES now live in the Core contract, and are re-exported here
 * so every existing import keeps working. They had to move the day the
 * solver-facing request needed to name them: a type an engine receives cannot
 * be owned by a module inside the UI feature tree. The shape is byte-identical
 * and there is still exactly one definition of it.
 *
 * Deliberately NOT here (and not this sprint): any endpoint, Python service,
 * CP-SAT call, local repair, or lock persistence. The request is built, shown,
 * and — for now — goes no further than the confirmation dialog.
 */

export type {
  PlanningRegenerationRequest,
  RegeneratedShiftEdit,
} from "@/features/core/planning-contract/types/regeneration"

/** The three toggles the dialog offers, mapped onto the request's booleans. */
export interface RegenerationOptions {
  readonly preserveLockedShifts: boolean
  readonly preserveManualEdits: boolean
  readonly minimizeOtherChanges: boolean
}

/** What the dialog shows before anyone confirms: how much local work is at stake. */
export interface RegenerationSummary {
  readonly lockedShiftCount: number
  readonly editedShiftCount: number
  /** True when there is neither a lock nor an edit — nothing to preserve. */
  readonly isEmpty: boolean
}

export const DEFAULT_REGENERATION_OPTIONS: RegenerationOptions = {
  preserveLockedShifts: true,
  preserveManualEdits: true,
  minimizeOtherChanges: false,
}

/**
 * Build the regeneration request from the current local state.
 *
 * Pure and total: it reads the overrides and the lock set out of the edit
 * state, pairs them with the chosen options, and returns data. It never calls a
 * generator, so it cannot pretend V2 honours these constraints — it only records
 * that the manager asked for them.
 *
 * The edited shifts are sorted by id so the request is deterministic: the same
 * local state always yields the same request, which keeps it comparable and
 * testable.
 */
export function buildRegenerationRequest(
  state: ShiftEditState,
  options: RegenerationOptions
): PlanningRegenerationRequest {
  const editedShifts: RegeneratedShiftEdit[] = Object.entries(state.overrides)
    .map(([shiftId, override]) => ({
      shiftId,
      startMinute: override.startMinutes,
      endMinute: override.endMinutes,
    }))
    .sort((left, right) => left.shiftId.localeCompare(right.shiftId))

  const lockedShiftIds = [...state.lockedShiftIds].sort((left, right) => left.localeCompare(right))

  return {
    preserveLockedShifts: options.preserveLockedShifts,
    preserveManualEdits: options.preserveManualEdits,
    minimizeOtherChanges: options.minimizeOtherChanges,
    lockedShiftIds,
    editedShifts,
  }
}

/** The headline counts, for the dialog. Reads the same state, no request needed. */
export function summarizeLocalWork(state: ShiftEditState): RegenerationSummary {
  const lockedShiftCount = state.lockedShiftIds.size
  const editedShiftCount = Object.keys(state.overrides).length
  return {
    lockedShiftCount,
    editedShiftCount,
    isEmpty: lockedShiftCount === 0 && editedShiftCount === 0,
  }
}
