import type {
  EmployeeId,
  IsoDate,
  TimeWindow,
  WeekDay,
} from "@/features/core/models"

import type {
  AvailabilityStatus,
  Period,
  UnavailableReason,
} from "@/features/core/employee-engine/types"

/**
 * A schedulable time window within a day. Reuses the core `TimeWindow` value
 * object (no duplication).
 */
export type AvailabilityWindow = TimeWindow

/**
 * Availability for a single, concrete calendar date.
 *
 * Availability is date-based (not just a weekly pattern) so date-specific
 * scenarios — one-day exceptions, absences, public holidays — can be
 * represented. `weekDay` is provided for convenience.
 */
export interface DailyAvailability {
  readonly date: IsoDate
  readonly weekDay: WeekDay
  readonly status: AvailabilityStatus
  /** Set when `status` is `unavailable`; explains which core fact caused it. */
  readonly unavailableReason?: UnavailableReason
  /** Schedulable windows for the day (empty when unavailable). */
  readonly windows: readonly AvailabilityWindow[]
}

/**
 * EmployeeAvailability — WHEN an employee can be scheduled across a period,
 * resolved per calendar date. A DERIVED read-model (no availability entity in
 * the core). See `AvailabilityCalculator`.
 */
export interface EmployeeAvailability {
  readonly employeeId: EmployeeId
  readonly period: Period
  readonly days: readonly DailyAvailability[]
}
