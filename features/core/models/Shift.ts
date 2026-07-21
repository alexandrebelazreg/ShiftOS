import type {
  IsoDate,
  ShiftId,
  ShiftTemplateId,
  StoreId,
  TimeString,
  Timestamps,
} from "@/features/core/models/common"

/**
 * How a shift came to exist.
 * - `library`: instantiated from a ShiftTemplate.
 * - `dynamic`: produced by dynamic generation.
 */
export const SHIFT_SOURCES = ["library", "dynamic"] as const
export type ShiftSource = (typeof SHIFT_SOURCES)[number]

/**
 * A continuous working interval. A regular shift has one segment; a split
 * shift has two or more (with a gap between them), as permitted by the store's
 * SplitShiftPolicy.
 *
 * `endDayOffset` supports night / cross-day shifts: 0 (default) means the
 * segment ends the same calendar day; 1 means it ends the following day (e.g.
 * 22:00 → 06:00 with `endDayOffset: 1`).
 */
export interface ShiftSegment {
  startTime: TimeString
  endTime: TimeString
  endDayOffset?: number
}

/**
 * Shift — a concrete, schedulable interval on a specific date at a store.
 *
 * Relationships:
 * - belongs to one Store (`storeId`, many-to-one).
 * - optionally derived from one ShiftTemplate (`templateId`, nullable).
 * - referenced by Assignments (see `Assignment.shiftId`).
 */
export interface Shift extends Timestamps {
  id: ShiftId
  storeId: StoreId
  /** Set when the shift originates from the Shift Library; null otherwise. */
  templateId: ShiftTemplateId | null

  date: IsoDate
  source: ShiftSource
  /** One segment for a regular shift, several for a split shift. */
  segments: ShiftSegment[]
}
