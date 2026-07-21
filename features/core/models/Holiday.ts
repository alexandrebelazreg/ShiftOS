import type {
  HolidayId,
  IsoDate,
  StoreId,
  Timestamps,
} from "@/features/core/models/common"

/**
 * Holiday — a public or store-observed non-working day for a store.
 *
 * Relationships:
 * - belongs to one Store (`storeId`, many-to-one).
 *
 * A holiday marks a specific calendar date. `recurringAnnually` flags fixed-date
 * holidays (e.g. Jan 1) for future expansion; the current model still stores one
 * concrete `date` per occurrence.
 */
export interface Holiday extends Timestamps {
  id: HolidayId
  storeId: StoreId
  date: IsoDate
  name: string
  recurringAnnually?: boolean
}
