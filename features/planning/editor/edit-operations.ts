import type {
  Assignment,
  EmployeeId,
  IsoDate,
  ShiftId,
  ShiftSegment,
} from "@/features/core/models"

import type { EditorState } from "@/features/planning/editor/editor-state"
import { withPlanning } from "@/features/planning/editor/editor-state"
import { assignmentIdFor, newShiftId } from "@/features/planning/editor/editor-ids"

/**
 * Pure edit operations on the single planning. Each returns a NEW `EditorState`
 * (immutable update) leaving the context untouched, so the caller can re-run the
 * engines on the result. None of them calculates, validates or scores — they
 * only reshape shifts/assignments; validation happens on re-evaluation.
 */

/** Move a shift to another day (its assignments follow it). */
export function moveShift(state: EditorState, shiftId: ShiftId, toDate: IsoDate): EditorState {
  const shifts = state.shifts.map((shift) =>
    shift.id === shiftId ? { ...shift, date: toDate, updatedAt: state.settings.now } : shift
  )
  return withPlanning(state, shifts, state.assignments)
}

/**
 * Swap the employees of two assignments (each keeps its shift). Ids are
 * regenerated from the new (shift, employee) pairing to stay consistent.
 */
export function swapEmployees(
  state: EditorState,
  assignmentIdA: string,
  assignmentIdB: string
): EditorState {
  const a = state.assignments.find((x) => x.id === assignmentIdA)
  const b = state.assignments.find((x) => x.id === assignmentIdB)
  if (!a || !b) return state

  const assignments = state.assignments.map((assignment) => {
    if (assignment.id === a.id) return reassign(assignment, b.employeeId, state.settings.now)
    if (assignment.id === b.id) return reassign(assignment, a.employeeId, state.settings.now)
    return assignment
  })
  return withPlanning(state, state.shifts, assignments)
}

/** Edit one segment's start / end / cross-midnight offset of a shift. */
export function editShiftTime(
  state: EditorState,
  shiftId: ShiftId,
  segmentIndex: number,
  segment: Partial<ShiftSegment>
): EditorState {
  const shifts = state.shifts.map((shift) => {
    if (shift.id !== shiftId) return shift
    const segments = shift.segments.map((current, index) =>
      index === segmentIndex ? { ...current, ...segment } : current
    )
    return { ...shift, segments, updatedAt: state.settings.now }
  })
  return withPlanning(state, shifts, state.assignments)
}

/** Create a shift for one employee on a day (adds the shift and its assignment). */
export function createShift(
  state: EditorState,
  params: {
    readonly date: IsoDate
    readonly employeeId: EmployeeId
    readonly segments: readonly ShiftSegment[]
  }
): EditorState {
  const startTime = params.segments[0]?.startTime ?? "00:00"
  const shiftId = newShiftId(params.date, startTime)
  const now = state.settings.now

  const shift = {
    id: shiftId,
    storeId: state.coreInput.store.id,
    templateId: null,
    date: params.date,
    source: "dynamic" as const,
    segments: [...params.segments],
    createdAt: now,
    updatedAt: now,
  }
  const assignment: Assignment = {
    id: assignmentIdFor(shiftId, params.employeeId),
    planningId: state.planning.id,
    shiftId,
    employeeId: params.employeeId,
    status: "proposed",
    createdAt: now,
    updatedAt: now,
  }

  return withPlanning(state, [...state.shifts, shift], [...state.assignments, assignment])
}

/** Delete a shift and every assignment on it. */
export function deleteShift(state: EditorState, shiftId: ShiftId): EditorState {
  return withPlanning(
    state,
    state.shifts.filter((shift) => shift.id !== shiftId),
    state.assignments.filter((assignment) => assignment.shiftId !== shiftId)
  )
}

function reassign(
  assignment: Assignment,
  employeeId: EmployeeId,
  now: string
): Assignment {
  return {
    ...assignment,
    id: assignmentIdFor(assignment.shiftId, employeeId),
    employeeId,
    updatedAt: now,
  }
}
