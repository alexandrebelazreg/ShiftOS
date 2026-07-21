import type { CapabilityKey } from "@/features/core/models"

import type { ValidationResult } from "@/features/core/employee-engine/types"

/**
 * CapabilityValidator — checks a set of granted capability keys (e.g. no
 * duplicates, known keys). Contract only; no validation logic.
 */
export interface CapabilityValidator {
  validate(capabilities: readonly CapabilityKey[]): ValidationResult
}
