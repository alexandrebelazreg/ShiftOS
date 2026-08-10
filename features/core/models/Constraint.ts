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
  "EARLIEST_START",
  "LATEST_END",
  // Les mêmes bornes, mais IMPOSÉES. « Ne commence pas avant 07:00 » laisse
  // le moteur choisir 09:00 ; « commence à 07:00 » ne le laisse pas. Deux
  // types plutôt qu'un drapeau sur les précédents : une borne et une valeur
  // exacte ne se relaxent pas de la même façon, et un lecteur qui voit
  // EARLIEST_START doit pouvoir se fier à ce qu'il lit.
  "EXACT_START",
  "EXACT_END",
  // Ouvrir ou fermer un jour donné, sans dire quel rayon : le salarié ouvre
  // celui qu'il sert ce jour-là. `day` porte le jour de la semaine.
  "MUST_OPEN",
  "MUST_CLOSE",
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
 * - time-of-day bounds (EARLIEST_START, LATEST_END) use `value` as an integer
 *   number of MINUTES SINCE MIDNIGHT, never an "HH:mm" string: the whole core
 *   reasons in minutes and a second representation would invite a rounding bug.
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
