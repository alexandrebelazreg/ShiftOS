import type {
  AssignmentId,
  EmployeeId,
  PlanningId,
  ShiftId,
  Timestamps,
} from "@/features/core/models/common"

/**
 * Status of an individual assignment.
 * TODO: confirm the assignment lifecycle with the product domain.
 */
export const ASSIGNMENT_STATUSES = ["proposed", "confirmed"] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

/**
 * Assignment — the join that puts one Employee on one Shift within a Planning.
 * This is the associative entity of the Planning ↔ Shift ↔ Employee triangle.
 *
 * Relationships:
 * - belongs to one Planning (`planningId`).
 * - references one Shift (`shiftId`).
 * - references one Employee (`employeeId`).
 */
export interface Assignment extends Timestamps {
  id: AssignmentId
  planningId: PlanningId
  shiftId: ShiftId
  employeeId: EmployeeId

  status: AssignmentStatus
}
