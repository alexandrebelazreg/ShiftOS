import type {
  AssignmentId,
  EmployeeId,
  PlanningId,
  ShiftId,
} from "@/features/core/models"

/**
 * Stable, unique registry key of a constraint, e.g. `"legal.max_daily_hours"`.
 *
 * This is the engine-level identifier used by the registry. It is distinct from
 * the `ConstraintId` branded entity id in `@/features/core/models` (which keys
 * the persisted employee-constraint record).
 */
export type ConstraintId = string

/**
 * The kind of entity a constraint reasons about. Determines which part of the
 * context is under evaluation.
 */
export const CONSTRAINT_SCOPES = [
  "assignment",
  "employee",
  "shift",
  "planning",
] as const
export type ConstraintScope = (typeof CONSTRAINT_SCOPES)[number]

/**
 * The concrete entity currently being evaluated, matching a `ConstraintScope`.
 * Ids are reused from the core domain — never redefined here.
 */
export type ConstraintTarget =
  | { readonly scope: "assignment"; readonly assignmentId: AssignmentId }
  | { readonly scope: "employee"; readonly employeeId: EmployeeId }
  | { readonly scope: "shift"; readonly shiftId: ShiftId }
  | { readonly scope: "planning"; readonly planningId: PlanningId }

/** A typed reference to a domain entity involved in a violation. */
export type EntityRef =
  | { readonly type: "employee"; readonly id: EmployeeId }
  | { readonly type: "shift"; readonly id: ShiftId }
  | { readonly type: "assignment"; readonly id: AssignmentId }
