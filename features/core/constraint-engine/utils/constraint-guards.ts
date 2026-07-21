import type { Constraint } from "@/features/core/constraint-engine/models"

/**
 * Trivial classification helpers (not evaluation logic). They let callers
 * partition constraints without reaching into the `type` field directly.
 */
export function isHardConstraint(constraint: Constraint): boolean {
  return constraint.type === "hard"
}

export function isSoftConstraint(constraint: Constraint): boolean {
  return constraint.type === "soft"
}
