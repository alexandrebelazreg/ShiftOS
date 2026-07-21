import type { EmployeeId, PreferenceId } from "@/features/core/models/common"

/**
 * Known preference types. Open set so new soft preferences can be added as
 * data without changing the Employee model.
 */
export const PREFERENCE_TYPES = [
  "PREFER_OPENING",
  "PREFER_CLOSING",
  "NOTES",
] as const
export type KnownPreferenceType = (typeof PREFERENCE_TYPES)[number]
export type PreferenceType = KnownPreferenceType | (string & {})

/**
 * Preference — a soft (non-binding) scheduling wish attached to an employee.
 *
 * Relationships:
 * - belongs to one Employee (`employeeId`, many-to-one).
 *
 * Generic payload:
 * - boolean preferences (PREFER_OPENING, PREFER_CLOSING) use `enabled`.
 * - free-text preferences (NOTES) use `note`.
 * - future preference types can carry `params`.
 */
export interface Preference {
  id: PreferenceId
  employeeId: EmployeeId
  type: PreferenceType
  enabled?: boolean | null
  note?: string | null
  params?: Record<string, unknown>
}
