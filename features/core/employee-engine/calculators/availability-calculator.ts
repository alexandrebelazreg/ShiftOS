import type {
  Absence,
  AvailabilityRule,
  Constraint,
  Contract,
  EmployeeId,
  Holiday,
  Store,
} from "@/features/core/models"

import type { EmployeeAvailability } from "@/features/core/employee-engine/models"
import type { Period } from "@/features/core/employee-engine/types"

/**
 * Everything needed to resolve an employee's availability across a period. All
 * fields are core domain data — the calculator invents nothing.
 */
export interface AvailabilityInput {
  readonly employeeId: EmployeeId
  readonly period: Period
  readonly store: Store
  readonly contract: Contract | null
  /** Existing day-level constraints (fixed day off / forbidden day). */
  readonly constraints: readonly Constraint[]
  /** Recurring, one-day and range availability rules for the employee. */
  readonly availabilityRules: readonly AvailabilityRule[]
  /** Absences (leave, sickness, training, temporary unavailability). */
  readonly absences: readonly Absence[]
  /** Store holidays. */
  readonly holidays: readonly Holiday[]
}

/**
 * AvailabilityCalculator — derives a per-date `EmployeeAvailability` from the
 * store schedule/holidays, the contract, the employee's constraints, absences
 * and availability rules. Contract only.
 */
export interface AvailabilityCalculator {
  calculate(input: AvailabilityInput): EmployeeAvailability
}
