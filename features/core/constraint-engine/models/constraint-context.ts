import type {
  Absence,
  Assignment,
  AvailabilityRule,
  Constraint as EmployeeConstraintRecord,
  Contract,
  DateRange,
  Employee,
  Holiday,
  IsoDateTime,
  Planning,
  Shift,
  Store,
} from "@/features/core/models"

/**
 * Read-only snapshot of the scheduling problem evaluated by the engine.
 *
 * It aggregates the core domain data a constraint may need to reach a verdict:
 * the planning under evaluation, its store, the employees and their contracts,
 * the shifts and assignments, and the availability-related data (rules,
 * absences, holidays, employee constraints). Constraints READ this; they never
 * mutate it.
 *
 * All fields reference core domain models — the engine never redefines them.
 */
export interface ConstraintContext {
  /** Evaluation clock, for time-relative reasoning. */
  readonly now: IsoDateTime
  /** The horizon the planning covers (drives the calculators). */
  readonly period: DateRange

  readonly store: Store
  readonly planning: Planning

  readonly employees: readonly Employee[]
  readonly contracts: readonly Contract[]
  readonly shifts: readonly Shift[]
  readonly assignments: readonly Assignment[]

  readonly availabilityRules: readonly AvailabilityRule[]
  readonly absences: readonly Absence[]
  readonly holidays: readonly Holiday[]
  /** Core employee-constraint records (fixed day off / forbidden day, …). */
  readonly employeeConstraints: readonly EmployeeConstraintRecord[]
}
