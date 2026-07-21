import type { StoreId } from "@/features/core/models"
import { WEEK_DAYS } from "@/features/core/models"

import type { StoreConfiguration } from "@/features/store/models"
import type {
  DayOpeningHours,
  OpeningHours,
} from "@/features/store/models/opening-hours"
import type { StoreConfigurationId } from "@/features/store/types/configuration.types"

function brand<T>(value: string): T {
  return value as unknown as T
}

/** An unconfigured store has no invented operating hours. */
const DEFAULT_OPENING_HOURS: OpeningHours = WEEK_DAYS.map<DayOpeningHours>((day) => ({
  day,
  closed: true,
  ranges: [],
}))

/**
 * DEFAULT_STORE_CONFIGURATION — sensible, GENERIC starting values.
 *
 * No sector-, country- or tenant-specific value is baked in: the store name is
 * empty, the timezone is UTC, the currency a neutral placeholder, and the
 * fairness/scoring weights are the engines' own neutral defaults. Every value is
 * meant to be overridden by the manager. `id` / `storeId` are placeholders the
 * caller must set.
 */
export const DEFAULT_STORE_CONFIGURATION: StoreConfiguration = {
  id: brand<StoreConfigurationId>(""),
  storeId: brand<StoreId>(""),

  general: {
    name: "",
    timezone: "UTC",
    country: "",
    currency: "EUR",
    weekStart: "monday",
  },

  openingHours: DEFAULT_OPENING_HOURS,

  planning: {
    mode: "dynamic",
    granularity: 60,
    minShiftDuration: 120,
    maxShiftDuration: 600,
  },

  shift: {
    minRestBetweenShifts: 660, // 11h — a common statutory floor, overridable
    minDailyDuration: 120,
    maxDailyDuration: 600,
    maxWeeklyDuration: 2400, // 40h
    contractToleranceMinutes: 0,
  },

  splitShift: {
    enabled: false,
    minBreak: 60,
    maxBreak: 240,
    maxSplitShiftsPerEmployee: 3,
  },

  coverage: {
    defaultMinEmployeesPerShift: 1,
    profiles: [],
  },

  fairness: {
    weights: { workedHours: 1, opening: 1, closing: 1, weekend: 1, preferences: 1 },
    extraWeights: {},
    imbalanceThreshold: 0.5,
    warningThreshold: 0.75,
    minCohortSize: 2,
  },

  scoring: {
    weights: { coverage: 0.4, contract: 0.2, availability: 0.2, soft: 0.2 },
    warningCredit: 0.5,
    feasibilityThreshold: 0.6,
  },

  holidays: {
    observe: true,
    entries: [],
  },

  capabilities: {
    definitions: [],
  },
}

/**
 * Build a `StoreConfiguration` from the defaults, replacing whole sections with
 * any provided overrides. Section-level (shallow) merge keeps the result
 * predictable — a caller supplies a complete section or none of it.
 */
export function createStoreConfiguration(
  overrides: Partial<StoreConfiguration> = {}
): StoreConfiguration {
  return { ...DEFAULT_STORE_CONFIGURATION, ...overrides }
}
