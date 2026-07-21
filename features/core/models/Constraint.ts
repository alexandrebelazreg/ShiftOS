import type {
  ConstraintId,
  EmployeeId,
  WeekDay,
} from "@/features/core/models/common"

/**
 * Known constraint types. Open set (like capabilities) so new constraint kinds
 * can be added as data without changing the Employee model.
 */
export const CONSTRAINT_TYPES = [
  "FIXED_DAY_OFF",
  "FORBIDDEN_DAY",
  "MAX_OPENINGS",
  "MAX_CLOSINGS",
] as const
export type KnownConstraintType = (typeof CONSTRAINT_TYPES)[number]
export type ConstraintType = KnownConstraintType | (string & {})

/**
 * Constraint — a hard scheduling limit attached to an employee.
 *
 * Relationships:
 * - belongs to one Employee (`employeeId`, many-to-one).
 *
 * The payload is intentionally generic so one shape covers every constraint
 * type:
 * - day-scoped constraints (FIXED_DAY_OFF, FORBIDDEN_DAY) use `day`.
 * - count constraints (MAX_OPENINGS, MAX_CLOSINGS) use `value`.
 * - future constraint types can carry `params` without a schema change.
 *
 * Example: an employee off on Sunday is one `FIXED_DAY_OFF` row with
 * `day: "sunday"`.
 */
export interface Constraint {
  id: ConstraintId
  employeeId: EmployeeId
  type: ConstraintType
  day?: WeekDay | null
  value?: number | null
  /** Escape hatch for future, richer constraint types. */
  params?: Record<string, unknown>
}
