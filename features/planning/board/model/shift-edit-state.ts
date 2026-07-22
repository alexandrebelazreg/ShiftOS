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
 */

export interface ShiftOverride {
  readonly startMinutes: number
  readonly endMinutes: number
  readonly segments: readonly { readonly startMinutes: number; readonly endMinutes: number }[]
}

type OverrideMap = Readonly<Record<string, ShiftOverride>>

export interface ShiftEditState {
  readonly overrides: OverrideMap
  /** Previous override maps, oldest first. Undo pops the last one. */
  readonly history: readonly OverrideMap[]
}

export const EMPTY_EDIT_STATE: ShiftEditState = { overrides: {}, history: [] }

export function hasEdits(state: ShiftEditState): boolean {
  return Object.keys(state.overrides).length > 0
}

export function canUndo(state: ShiftEditState): boolean {
  return state.history.length > 0
}

/** How many shifts currently differ from what the engine produced. */
export function editedShiftCount(state: ShiftEditState): number {
  return Object.keys(state.overrides).length
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

/** Step back one edit. A no-op when nothing has been edited yet. */
export function undoShiftEdit(state: ShiftEditState): ShiftEditState {
  const previous = state.history[state.history.length - 1]
  if (previous === undefined) return state
  return { overrides: previous, history: state.history.slice(0, -1) }
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
    return {
      ...shift,
      startMinutes: start,
      endMinutes: end,
      workedMinutes: segments.reduce(
        (sum, segment) => sum + (segment.endMinutes - segment.startMinutes),
        0
      ),
      segments,
      opensDay: day?.opensAtMinutes === start,
      closesDay: day?.closesAtMinutes === end,
    }
  })

  return { ...input, shifts }
}
