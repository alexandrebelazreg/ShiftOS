import type { CapabilityKey, TimeString } from "@/features/core/models"

/**
 * CoverageRequirementTemplate — a reusable, date-independent demand segment. A
 * coverage profile is a set of these; the demand engine turns them into dated
 * `CoverageRequirement`s at generation time.
 */
export interface CoverageRequirementTemplate {
  readonly start: TimeString
  readonly end: TimeString
  /** Cross-midnight offset for the end time (0 = same day). */
  readonly endDayOffset?: number
  readonly minEmployees: number
  readonly maxEmployees?: number | null
  readonly requiredCapabilities?: readonly CapabilityKey[]
}

/**
 * CoverageProfile — a named, reusable staffing pattern (e.g. "Weekday",
 * "Weekend"). Models + services only in this sprint; no UI editor yet.
 */
export interface CoverageProfile {
  readonly id: string
  readonly name: string
  readonly requirements: readonly CoverageRequirementTemplate[]
}

/**
 * CoverageSettings — coverage configuration. `defaultMinEmployeesPerShift` feeds
 * the coverage constraint; `profiles` hold reusable demand templates.
 */
export interface CoverageSettings {
  readonly defaultMinEmployeesPerShift: number
  readonly profiles: readonly CoverageProfile[]
}
