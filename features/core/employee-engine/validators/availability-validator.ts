import type { EmployeeAvailability } from "@/features/core/employee-engine/models"
import type { ValidationResult } from "@/features/core/employee-engine/types"

/**
 * AvailabilityValidator — checks an `EmployeeAvailability` for coherence
 * (e.g. windows within opening hours). Contract only; no validation logic.
 */
export interface AvailabilityValidator {
  validate(availability: EmployeeAvailability): ValidationResult
}
