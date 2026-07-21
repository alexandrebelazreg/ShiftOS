/**
 * Deterministic id helpers. Ids are DERIVED from the entities they connect
 * (requirement id, shift id, employee id), never from a counter or clock, so
 * generation is fully reproducible and ids are human-traceable.
 */

import type { AssignmentId, EmployeeId, ShiftId } from "@/features/core/models"
import type { CoverageRequirementId } from "@/features/core/demand-engine"

function brandId<T>(value: string): T {
  return value as unknown as T
}

/** Stable shift id for a requirement, e.g. `shift_req_1`. */
export function shiftIdFor(requirementId: CoverageRequirementId): ShiftId {
  return brandId<ShiftId>(`shift_${requirementId}`)
}

/** Stable id for one employee's mutable work period. */
export function employeeShiftIdFor(
  requirementId: CoverageRequirementId,
  employeeId: EmployeeId,
  date: string
): ShiftId {
  return brandId<ShiftId>(`shift_${employeeId}_${date}_${requirementId}`)
}

/** Stable assignment id for a (shift, employee) pair. */
export function assignmentIdFor(shiftId: ShiftId, employeeId: string): AssignmentId {
  return brandId<AssignmentId>(`assignment_${shiftId}_${employeeId}`)
}
