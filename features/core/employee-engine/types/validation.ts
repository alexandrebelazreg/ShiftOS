/**
 * Result vocabulary shared by every validator. Validators return this shape;
 * they never throw. (This is data-shape validation, distinct from the
 * constraint-engine's `ConstraintResult`, which evaluates scheduling rules.)
 */
export type ValidationSeverity = "error" | "warning"

export interface ValidationIssue {
  /** Stable machine code, e.g. "contract.weekly_hours.out_of_range". */
  readonly code: string
  readonly message: string
  readonly severity: ValidationSeverity
  /** Optional path to the offending field. */
  readonly path?: string
}

export interface ValidationResult {
  readonly valid: boolean
  readonly issues: readonly ValidationIssue[]
}
