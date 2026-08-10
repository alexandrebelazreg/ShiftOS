import type { BoardShift, PlanningBoardInput } from "@/features/planning/board/model/board-input"
import type { EditableShift } from "@/features/planning/board/model/shift-edit"

/**
 * The manager's local changes, held apart from the generated schedule.
 *
 * Nothing here mutates what the engine produced. An edit is recorded as an
 * override keyed by shift id, and the board input is rebuilt from the original
 * plus the overrides every time it is read. That is what makes "réinitialiser"
 * a one-line operation instead of a regeneration, and what guarantees the
 * generated planning is still exactly there to compare against.
 *
 * The history is a stack of previous override maps, so undo restores a whole
 * consistent state rather than trying to invert one move.
 *
 * Locks live here too, as a third kind of local change alongside the overrides.
 * They are deliberately NOT part of the undo history: undoing a drag must not
 * silently unlock a shift the manager pinned. They DO clear on reset, because
 * reset means "back to exactly what the engine produced", which had no locks.
 * This is the shape the V3 integration will read: generation + edits + locks.
 */

export interface ShiftOverride {
  readonly startMinutes: number
  readonly endMinutes: number
  readonly segments: readonly { readonly startMinutes: number; readonly endMinutes: number }[]
}

/** The lock model, kept intentionally poor: an id and a boolean, nothing engine. */
export interface LockedShift {
  readonly shiftId: string
  readonly locked: boolean
}

type OverrideMap = Readonly<Record<string, ShiftOverride>>

export interface ShiftEditState {
  readonly overrides: OverrideMap
  /** Previous override maps, oldest first. Undo pops the last one. */
  readonly history: readonly OverrideMap[]
  /** Ids of shifts the manager pinned. Local only; no effect on generation yet. */
  readonly lockedShiftIds: ReadonlySet<string>
}

export const EMPTY_EDIT_STATE: ShiftEditState = {
  overrides: {},
  history: [],
  lockedShiftIds: new Set(),
}

export function hasEdits(state: ShiftEditState): boolean {
  return Object.keys(state.overrides).length > 0
}

/** Any local change at all — a geometry edit OR a lock. Drives "Réinitialiser". */
export function hasLocalChanges(state: ShiftEditState): boolean {
  return hasEdits(state) || state.lockedShiftIds.size > 0
}

export function canUndo(state: ShiftEditState): boolean {
  return state.history.length > 0
}

/** How many shifts currently differ from what the engine produced. */
export function editedShiftCount(state: ShiftEditState): number {
  return Object.keys(state.overrides).length
}

// ── Locks ────────────────────────────────────────────────────────────────────

export function isShiftLocked(state: ShiftEditState, shiftId: string): boolean {
  return state.lockedShiftIds.has(shiftId)
}

export function lockedShiftCount(state: ShiftEditState): number {
  return state.lockedShiftIds.size
}

/**
 * Set a shift's lock to an explicit value. Returns a new state with a fresh set
 * so the old one is never mutated; the overrides and the undo history are left
 * exactly as they were — locking is orthogonal to editing.
 */
export function setShiftLock(
  state: ShiftEditState,
  shiftId: string,
  locked: boolean
): ShiftEditState {
  if (isShiftLocked(state, shiftId) === locked) return state
  const next = new Set(state.lockedShiftIds)
  if (locked) next.add(shiftId)
  else next.delete(shiftId)
  return { ...state, lockedShiftIds: next }
}

/** Flip a shift's lock — the single action the toolbar button performs. */
export function toggleShiftLock(state: ShiftEditState, shiftId: string): ShiftEditState {
  return setShiftLock(state, shiftId, !isShiftLocked(state, shiftId))
}

/**
 * Record one edit. The previous map is pushed onto the history first, so undo
 * always lands on the state the user saw before this drag — including "no
 * override at all" for the first edit of a shift.
 */
export function applyShiftEdit(
  state: ShiftEditState,
  shiftId: string,
  shift: EditableShift
): ShiftEditState {
  return {
    ...state,
    overrides: {
      ...state.overrides,
      [shiftId]: {
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        segments: shift.segments.map((segment) => ({ ...segment })),
      },
    },
    history: [...state.history, state.overrides],
  }
}

/**
 * Step back one edit. A no-op when nothing has been edited yet. Locks are kept:
 * they are not part of the geometry history, so undoing a drag leaves them be.
 */
export function undoShiftEdit(state: ShiftEditState): ShiftEditState {
  const previous = state.history[state.history.length - 1]
  if (previous === undefined) return state
  return { ...state, overrides: previous, history: state.history.slice(0, -1) }
}

/** Drop every local change and go back to the generated schedule. */
export function resetShiftEdits(): ShiftEditState {
  return EMPTY_EDIT_STATE
}

/**
 * Rebuild the board input with the overrides applied.
 *
 * `workedMinutes`, `opensDay` and `closesDay` are recomputed rather than
 * carried over: a shift dragged off the opening hour is no longer an opening,
 * and the grid must say so immediately instead of keeping the colour it had
 * when the engine wrote it.
 *
 * Returns the input unchanged — same reference — when there is nothing to
 * apply, so an untouched board costs no rebuild.
 */
export function applyShiftEdits(
  input: PlanningBoardInput,
  state: ShiftEditState
): PlanningBoardInput {
  if (!hasEdits(state)) return input

  const dayByDate = new Map(input.days.map((day) => [day.date, day]))
  const shifts: BoardShift[] = input.shifts.map((shift) => {
    const override = state.overrides[shift.id]
    if (!override) return shift
    const day = dayByDate.get(shift.date)
    const segments = [...override.segments].sort(
      (left, right) => left.startMinutes - right.startMinutes
    )
    const start = segments[0]?.startMinutes ?? override.startMinutes
    const end = segments[segments.length - 1]?.endMinutes ?? override.endMinutes
    const movedBy = start - shift.startMinutes
    const pureMove = end - shift.endMinutes === movedBy
    const sectorAssignments = shift.sectorAssignments?.map((block, index, blocks) => ({
      ...block,
      startMinutes: pureMove
        ? block.startMinutes + movedBy
        : index === 0
          ? start
          : block.startMinutes,
      endMinutes: pureMove
        ? block.endMinutes + movedBy
        : index === blocks.length - 1
          ? end
          : block.endMinutes,
    }))
    return {
      ...shift,
      startMinutes: start,
      endMinutes: end,
      workedMinutes: segments.reduce(
        (sum, segment) => sum + (segment.endMinutes - segment.startMinutes),
        0
      ),
      segments,
      ...(sectorAssignments ? { sectorAssignments } : {}),
      opensDay: day?.opensAtMinutes === start,
      closesDay: day?.closesAtMinutes === end,
    }
  })

  return { ...input, shifts }
}
