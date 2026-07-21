import type { DaySchedule } from "@/features/core/models"

import type { StoreConfiguration } from "@/features/store/models"

/**
 * Flatten the configuration's multi-range opening hours into the core `Store`'s
 * single open/close pair per day: earliest range start → `opensAt`, latest range
 * end → `closesAt`. A closed day (or one with no ranges) maps to `closed` with
 * null bounds.
 *
 * This is a shape TRANSLATION, not a decision — it loses the intra-day gaps
 * because the core `Store` schedule does not model them; nothing is computed.
 */
export function toCoreOpeningHours(config: StoreConfiguration): DaySchedule[] {
  return config.openingHours.map((day): DaySchedule => {
    if (day.closed || day.ranges.length === 0) {
      return { day: day.day, closed: true, opensAt: null, closesAt: null }
    }
    const opensAt = day.ranges.reduce(
      (min, r) => (r.start < min ? r.start : min),
      day.ranges[0].start
    )
    const closesAt = day.ranges.reduce(
      (max, r) => (r.end > max ? r.end : max),
      day.ranges[0].end
    )
    return { day: day.day, closed: false, opensAt, closesAt }
  })
}
