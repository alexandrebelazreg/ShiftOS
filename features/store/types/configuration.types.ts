import type { Brand, WeekDay } from "@/features/core/models"

/**
 * Small configuration-level vocabulary. Business enums (week days, planning
 * mode, granularity, split-shift kinds) are NOT redefined here — they live in
 * `@/features/core/models`, the single source of truth.
 */

/** Stable identifier of a store configuration record. */
export type StoreConfigurationId = Brand<string, "StoreConfigurationId">

/** The weekday a planning week starts on (reuses the core weekday vocabulary). */
export type WeekStart = WeekDay

/** ISO 4217 currency code, e.g. "EUR", "USD". A plain string alias for intent. */
export type CurrencyCode = string
