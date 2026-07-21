import type { EmployeeProfile } from "@/features/core/employee-engine/models"

/**
 * Trivial classification helper (not business logic): whether a profile's
 * employee is currently active.
 */
export function isActiveEmployeeProfile(profile: EmployeeProfile): boolean {
  return profile.employee.status === "active"
}
