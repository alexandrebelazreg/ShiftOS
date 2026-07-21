import type { StoreId, TimeGranularity } from "@/features/core/models"
import { SPLIT_SHIFT_DETAIL_POLICIES } from "@/features/core/models"

import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { StoreConfiguration } from "@/features/store/models"
import type { StoreConfigurationId } from "@/features/store/types/configuration.types"
import { createStoreConfiguration } from "@/features/store/defaults"

function brand<T>(value: string): T {
  return value as unknown as T
}

/** Deterministic ids for the current single-store, no-persistence phase. */
export const DEFAULT_STORE_ID = brand<StoreId>("store_1")
const DEFAULT_CONFIG_ID = brand<StoreConfigurationId>("config_1")

/**
 * Translate the onboarding form's `StoreConfig` into the canonical
 * `StoreConfiguration` the engines consume. Pure shape/unit translation
 * (hours → minutes, single range per day, split policy → enabled flag); the
 * unset sections (coverage, fairness, scoring, holidays, capabilities) fall back
 * to the generic defaults. No business logic.
 */
export function storeConfigurationFromOnboarding(form: StoreConfig): StoreConfiguration {
  const splitEnabled = SPLIT_SHIFT_DETAIL_POLICIES.includes(form.splitShiftPolicy)

  return createStoreConfiguration({
    id: DEFAULT_CONFIG_ID,
    storeId: DEFAULT_STORE_ID,
    general: {
      name: form.name,
      timezone: form.timezone,
      country: form.country,
      currency: "EUR",
      weekStart: "monday",
    },
    openingHours: form.openingHours.map((day) => ({
      day: day.day,
      closed: day.closed,
      ranges: day.closed ? [] : [{ start: day.opensAt, end: day.closesAt }],
    })),
    planning: {
      mode: form.planningMode,
      granularity: (form.timeGranularity ?? 60) as TimeGranularity,
      minShiftDuration: form.minShiftDuration ?? 120,
      maxShiftDuration: form.maxShiftDuration ?? 600,
    },
    shift: {
      minRestBetweenShifts: form.minRestBetweenShifts * 60,
      minDailyDuration: form.minDailyHours * 60,
      maxDailyDuration: form.maxDailyHours * 60,
      maxWeeklyDuration: (form.maxWeeklyHoursOverride ?? 40) * 60,
      contractToleranceMinutes: 0,
    },
    splitShift: {
      enabled: splitEnabled,
      minBreak: form.minSplitDuration ?? 60,
      maxBreak: form.maxSplitDuration ?? 240,
      maxSplitShiftsPerEmployee: form.maxSplitShiftsPerWeek ?? 3,
    },
  })
}
