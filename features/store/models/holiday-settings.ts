import type { IsoDate } from "@/features/core/models"

/**
 * HolidayEntry — one observed non-working date.
 */
export interface HolidayEntry {
  readonly date: IsoDate
  readonly name: string
  /** True for fixed-date holidays repeating every year. */
  readonly recurringAnnually?: boolean
}

/**
 * HolidaySettings — which holidays the store observes. `observe` toggles the
 * whole set on/off without discarding the entries.
 */
export interface HolidaySettings {
  readonly observe: boolean
  readonly entries: readonly HolidayEntry[]
}
