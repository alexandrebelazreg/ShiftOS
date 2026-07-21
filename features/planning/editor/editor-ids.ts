import type { AssignmentId, ShiftId } from "@/features/core/models"

/**
 * Deterministic id helpers for edited entities. Ids are DERIVED from content so
 * the same edit always yields the same ids (reproducible, and stable React
 * keys). Branding happens only here.
 */

function brand<T>(value: string): T {
  return value as unknown as T
}

/** Shift id for a newly created shift, from its date + start time. */
export function newShiftId(date: string, startTime: string): ShiftId {
  return brand<ShiftId>(`shift_edit_${date}_${startTime}`)
}

/** Assignment id for a (shift, employee) pair. */
export function assignmentIdFor(shiftId: ShiftId, employeeId: string): AssignmentId {
  return brand<AssignmentId>(`assignment_${shiftId}_${employeeId}`)
}
