import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import type {
  PlanningRegenerationRequest,
  RegeneratedShiftEdit,
} from "@/features/core/planning-contract/types/regeneration"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"

/**
 * Assemble the one value an engine is given, from the two the application holds.
 *
 * Pure and total: it reads its arguments, copies what it keeps and returns
 * data. It calls no engine, so it cannot pretend any of them honours what the
 * request asks for — it only records that the manager asked.
 *
 * Two properties it guarantees, and that the adapters may rely on:
 *
 * - CANONICAL. Locks and edits come out deduplicated and sorted by id, so the
 *   same local state always yields the same request. Two requests can then be
 *   compared, hashed or cached without normalising them first, and a solver
 *   cannot become non-deterministic merely because a `Set` iterated differently.
 * - DETACHED. Every collection is copied, so the request keeps saying what the
 *   manager asked at the moment it was built even if the board state moves on
 *   underneath. An in-flight solve reading a half-mutated intent is a class of
 *   bug that simply cannot occur here.
 *
 * The `problem` is passed through by reference and NOT frozen: it belongs to
 * the caller, it is already immutable by type, and freezing another module's
 * object graph as a side effect is a worse hazard than the one it prevents.
 */
export function buildSolvePlanningRequest(
  problem: PlanningProblemV3,
  regeneration?: PlanningRegenerationRequest | null
): SolvePlanningRequest {
  if (regeneration === undefined || regeneration === null) {
    return Object.freeze({ problem })
  }

  return Object.freeze({
    problem,
    regeneration: normalizeRegeneration(regeneration),
  })
}

function normalizeRegeneration(
  regeneration: PlanningRegenerationRequest
): PlanningRegenerationRequest {
  return Object.freeze({
    preserveLockedShifts: regeneration.preserveLockedShifts,
    preserveManualEdits: regeneration.preserveManualEdits,
    minimizeOtherChanges: regeneration.minimizeOtherChanges,
    lockedShiftIds: normalizeLocks(regeneration.lockedShiftIds),
    editedShifts: normalizeEdits(regeneration.editedShifts),
  })
}

function normalizeLocks(lockedShiftIds: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(lockedShiftIds)].sort((left, right) => left.localeCompare(right))
  )
}

/**
 * One entry per shift, last occurrence wins.
 *
 * A duplicate id means the same shift was described twice; the later
 * description is the manager's more recent intent. Silently keeping both would
 * hand the solver two contradictory geometries for one shift.
 *
 * Edits are copied field by field rather than spread, so an extra property
 * carried by a caller's object never travels to an engine as an undeclared
 * input. Degenerate geometry (`endMinute <= startMinute`) is kept, not dropped:
 * dropping it would hide a caller's bug behind a plausible-looking request,
 * and rejecting it is the validator's job, not this function's.
 */
function normalizeEdits(
  editedShifts: readonly RegeneratedShiftEdit[]
): readonly RegeneratedShiftEdit[] {
  const byShiftId = new Map<string, RegeneratedShiftEdit>()
  for (const edit of editedShifts) {
    byShiftId.set(
      edit.shiftId,
      Object.freeze({
        shiftId: edit.shiftId,
        startMinute: edit.startMinute,
        endMinute: edit.endMinute,
      })
    )
  }

  return Object.freeze(
    [...byShiftId.values()].sort((left, right) => left.shiftId.localeCompare(right.shiftId))
  )
}
