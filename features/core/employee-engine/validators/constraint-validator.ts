import type { Constraint } from "@/features/core/models"

import type { ValidationResult } from "@/features/core/employee-engine/types"

/**
 * ConstraintValidator — checks a persisted employee `Constraint` record (core
 * data, e.g. a fixed day off) for validity. Contract only; no validation logic.
 *
 * This validates constraint DATA; it does not evaluate scheduling rules — that
 * is the constraint-engine's responsibility.
 */
export interface ConstraintValidator {
  validate(constraint: Constraint): ValidationResult
}
