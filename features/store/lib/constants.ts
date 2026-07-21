import type {
  PlanningMode,
  SplitShiftPolicyKind,
  TimeGranularity,
  WeekDay,
} from "@/features/core/models"

/** Human-readable labels for each day of the week. */
export const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
}

export const PLANNING_MODE_OPTIONS: {
  value: PlanningMode
  label: string
  description: string
}[] = [
  {
    value: "shift_library",
    label: "Shift Library",
    description: "Build plannings from a fixed catalogue of predefined shifts.",
  },
  {
    value: "dynamic",
    label: "Dynamic Shift Generation",
    description: "Let ShiftOS generate shifts within the bounds you define.",
  },
]

export const SPLIT_SHIFT_POLICY_OPTIONS: {
  value: SplitShiftPolicyKind
  label: string
  description: string
}[] = [
  {
    value: "forbidden",
    label: "Forbidden",
    description: "Split shifts are never allowed.",
  },
  {
    value: "exceptional",
    label: "Exceptional",
    description: "Allowed only in exceptional cases.",
  },
  {
    value: "allowed",
    label: "Allowed",
    description: "Allowed within the configured limits.",
  },
  {
    value: "free",
    label: "Free",
    description: "No restriction beyond the configured limits.",
  },
]

export const TIME_GRANULARITY_OPTIONS: { value: TimeGranularity; label: string }[] =
  [
    { value: 15, label: "15 min" },
    { value: 30, label: "30 min" },
    { value: 60, label: "60 min" },
  ]

/**
 * Mocked reference data for the select inputs. Replace with a real source
 * (API / config) when the backend exists.
 */
export const COUNTRY_OPTIONS = [
  "France",
  "Belgium",
  "Spain",
  "Germany",
  "United Kingdom",
  "United States",
] as const

export const TIMEZONE_OPTIONS = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Madrid",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
] as const
