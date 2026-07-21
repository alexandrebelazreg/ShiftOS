/**
 * Per-requirement coverage verdict, by head-count.
 * - `covered`        — assigned count within [min, max].
 * - `under_covered`  — fewer than the minimum are assigned.
 * - `over_covered`   — more than the maximum are assigned.
 */
export const COVERAGE_STATUSES = [
  "covered",
  "under_covered",
  "over_covered",
] as const
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number]

/**
 * Importance of a requirement. Same 4-level scale as the business rules
 * (Critical / High / Medium / Low). Kept local so the demand model stays
 * independent of the constraint engine.
 */
export const DEMAND_PRIORITIES = ["critical", "high", "medium", "low"] as const
export type DemandPriority = (typeof DEMAND_PRIORITIES)[number]
