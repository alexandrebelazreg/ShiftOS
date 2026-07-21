import type {
  ShiftTemplateId,
  StoreId,
  TimeString,
  Timestamps,
  WeekDay,
} from "@/features/core/models/common"

/**
 * ShiftTemplate — a reusable, predefined shift in a store's "Shift Library".
 * Used to assemble plannings when the store's planning mode is `shift_library`.
 *
 * Relationships:
 * - belongs to one Store (`storeId`, many-to-one).
 * - referenced by many Shifts (see `Shift.templateId`).
 */
export interface ShiftTemplate extends Timestamps {
  id: ShiftTemplateId
  storeId: StoreId

  /** Display name, e.g. "Morning". */
  name: string
  startTime: TimeString
  endTime: TimeString
  /** Week days this template applies to; empty means "any day". */
  applicableDays: WeekDay[]

  // TODO: unpaid break duration, color/label, headcount — once defined.
}
