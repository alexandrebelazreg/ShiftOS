import type { StoreFormValues } from "@/features/store/types/store.types"
import { WEEK_DAYS } from "@/features/core/models"

/** Days closed by default in a fresh configuration. */
/**
 * Empty-but-valid starting point for the onboarding form. Numeric fields are
 * left as empty strings so the form renders blank rather than pre-filled.
 */
export const storeFormDefaults: StoreFormValues = {
  name: "",
  brand: "",
  address: "",
  city: "",
  postalCode: "",
  country: "",
  timezone: "",

  openingHours: WEEK_DAYS.map((day) => ({
    day,
    closed: false,
    opensAt: "",
    closesAt: "",
  })),

  planningMode: "shift_library",
  minShiftDuration: "",
  maxShiftDuration: "",
  timeGranularity: "",

  splitShiftPolicy: "forbidden",
  minSplitDuration: "",
  maxSplitDuration: "",
  maxSplitShiftsPerWeek: "",

  minDailyHours: "",
  maxDailyHours: "",
  minRestBetweenShifts: "",
  maxWeeklyHoursOverride: "",
}
