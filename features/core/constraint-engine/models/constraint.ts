import type { ConstraintContext } from "@/features/core/constraint-engine/models/constraint-context"
import type { ConstraintResult } from "@/features/core/constraint-engine/models/constraint-result"
import type {
  ConstraintCategory,
  ConstraintId,
  ConstraintPriority,
  ConstraintType,
} from "@/features/core/constraint-engine/types"

/** Presentation/explainability metadata shown to managers. */
export interface ConstraintMetadata {
  /** Short human label, e.g. "Shift coverage". */
  readonly label: string
  /** What the constraint enforces and why. */
  readonly description: string
}

/**
 * A constraint — an independently pluggable, evaluable scheduling rule.
 *
 * A constraint bundles identity + classification, an on/off toggle, presentation
 * metadata and its decision function. Concrete constraints are produced by small
 * factory files that bake in their configuration; the engine never hard-codes a
 * constraint — it only iterates whatever the registry holds.
 *
 * This engine-level `Constraint` (a rule) is distinct from the persisted
 * `Constraint` data entity in `@/features/core/models` (an employee record).
 */
export interface Constraint {
  /** Stable registry key, e.g. "coverage.shift_coverage". */
  readonly id: ConstraintId
  readonly category: ConstraintCategory
  /** `hard` blocks feasibility; `soft` only warns. */
  readonly type: ConstraintType
  readonly priority: ConstraintPriority
  /** Whether the constraint participates in evaluation (toggle on/off). */
  enabled: boolean
  readonly metadata: ConstraintMetadata

  /**
   * Pure decision function — the single place a constraint's logic lives. Given
   * a read-only context it returns a result (outcome + any violations). It must
   * not mutate the context. Any configuration is captured by the factory that
   * builds the constraint.
   */
  evaluate(context: ConstraintContext): ConstraintResult
}
