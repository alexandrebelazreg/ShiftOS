import type {
  AbsenceId,
  DateRange,
  EmployeeId,
  Timestamps,
} from "@/features/core/models/common"

/**
 * Reason an employee is absent over a period. OPEN set so new absence kinds can
 * be added as data without changing the model.
 */
export const ABSENCE_TYPES = [
  "paid_leave",
  "sick_leave",
  "training",
  "unpaid_leave",
  "temporary_unavailability",
  "other",
] as const
export type KnownAbsenceType = (typeof ABSENCE_TYPES)[number]
export type AbsenceType = KnownAbsenceType | (string & {})

/**
 * Absence — a period during which an employee is not available to work, with a
 * typed reason (paid leave, sick leave, training, temporary unavailability, …).
 *
 * Relationships:
 * - belongs to one Employee (`employeeId`, many-to-one).
 */
export interface Absence extends Timestamps {
  id: AbsenceId
  employeeId: EmployeeId
  type: AbsenceType
  /** Inclusive date range covered by the absence. */
  range: DateRange
  note?: string
}
