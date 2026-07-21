import type {
  AvailabilityRuleId,
  DateRange,
  EmployeeId,
  IsoDate,
  TimeWindow,
  Timestamps,
  WeekDay,
} from "@/features/core/models/common"

/**
 * Whether a rule grants or removes availability.
 * - `available`   — the employee CAN be scheduled (recurring or exceptional).
 * - `unavailable` — the employee CANNOT be scheduled (one-off or temporary).
 */
export const AVAILABILITY_EFFECTS = ["available", "unavailable"] as const
export type AvailabilityEffect = (typeof AVAILABILITY_EFFECTS)[number]

/**
 * How the rule applies over time.
 * - `recurring`  — every occurrence of `weekDay`.
 * - `date`       — a single calendar `date` (a one-day exception).
 * - `date_range` — a `range` of dates (e.g. temporary unavailability).
 */
export const AVAILABILITY_RULE_KINDS = ["recurring", "date", "date_range"] as const
export type AvailabilityRuleKind = (typeof AVAILABILITY_RULE_KINDS)[number]

/**
 * AvailabilityRule — a declared availability statement for an employee.
 *
 * A single flat shape covers recurring, date-specific and range rules so it maps
 * cleanly to a future table. Exactly one of `weekDay` / `date` / `range` is set,
 * matching `kind`:
 * - `recurring`  → `weekDay`
 * - `date`       → `date`
 * - `date_range` → `range`
 *
 * `window` optionally restricts availability to a time-of-day interval.
 *
 * Relationships:
 * - belongs to one Employee (`employeeId`, many-to-one).
 */
export interface AvailabilityRule extends Timestamps {
  id: AvailabilityRuleId
  employeeId: EmployeeId
  effect: AvailabilityEffect
  kind: AvailabilityRuleKind
  weekDay?: WeekDay | null
  date?: IsoDate | null
  range?: DateRange | null
  window?: TimeWindow | null
}
