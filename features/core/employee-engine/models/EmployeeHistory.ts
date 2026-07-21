import type {
  AssignmentId,
  EmployeeId,
  IsoDate,
  IsoDateTime,
  PlanningId,
} from "@/features/core/models"

import type {
  EmployeeLifecycleEventType,
  Period,
} from "@/features/core/employee-engine/types"

/** A past assignment the employee worked, referenced by core ids. */
export interface HistoricalAssignment {
  readonly assignmentId: AssignmentId
  readonly planningId: PlanningId
  readonly date: IsoDate
}

/** A lifecycle event (hired, activated, contract changed, …). */
export interface EmployeeLifecycleEvent {
  readonly type: EmployeeLifecycleEventType
  readonly occurredAt: IsoDateTime
  readonly metadata?: Record<string, unknown>
}

/**
 * EmployeeHistory — the employee's past over a period: worked assignments and
 * lifecycle events. Read-only; feeds experience scoring and audit views.
 */
export interface EmployeeHistory {
  readonly employeeId: EmployeeId
  readonly period: Period
  readonly assignments: readonly HistoricalAssignment[]
  readonly events: readonly EmployeeLifecycleEvent[]
}
