/**
 * Form-level (view-model) types for the Store onboarding feature.
 *
 * Business vocabulary (week days, planning mode, split-shift policy, …) is NOT
 * defined here — it lives in the core domain (`@/features/core/models`), the
 * single source of truth. These are the raw shapes React Hook Form holds:
 * numeric inputs stay as strings until Zod coerces them on submit.
 */
import type {
  PlanningMode,
  SplitShiftPolicyKind,
  WeekDay,
} from "@/features/core/models"

/** Per-day opening hours as edited in the form. */
export interface DayScheduleValues {
  day: WeekDay
  closed: boolean
  opensAt: string
  closesAt: string
}

/** Shape held by React Hook Form for the store onboarding wizard. */
export interface StoreFormValues {
  // Section 1 — Store information
  name: string
  brand: string
  address: string
  city: string
  postalCode: string
  country: string
  timezone: string

  // Section 2 — Opening hours
  openingHours: DayScheduleValues[]

  // Section 3 — Planning mode
  planningMode: PlanningMode
  minShiftDuration: string
  maxShiftDuration: string
  timeGranularity: string

  // Section 4 — Split shift policy
  splitShiftPolicy: SplitShiftPolicyKind
  minSplitDuration: string
  maxSplitDuration: string
  maxSplitShiftsPerWeek: string

  // Section 5 — General rules
  minDailyHours: string
  maxDailyHours: string
  minRestBetweenShifts: string
  maxWeeklyHoursOverride: string
}
