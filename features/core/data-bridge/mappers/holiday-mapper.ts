import type { Holiday, IsoDateTime, StoreId } from "@/features/core/models"

import type { StoreConfiguration } from "@/features/store/models"
import { toHolidayId } from "@/features/core/data-bridge/adapters"

/**
 * Translate the store configuration's observed holidays into core `Holiday`
 * records for the store. When `observe` is off, none are produced. Pure shape
 * translation.
 */
export function mapHolidays(
  config: StoreConfiguration,
  storeId: StoreId,
  now: IsoDateTime
): Holiday[] {
  if (!config.holidays.observe) return []

  return config.holidays.entries.map((entry) => ({
    id: toHolidayId(`holiday_${entry.date}`),
    storeId,
    date: entry.date,
    name: entry.name,
    recurringAnnually: entry.recurringAnnually,
    createdAt: now,
    updatedAt: now,
  }))
}
