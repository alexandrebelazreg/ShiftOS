import type {
  Constraint,
  ConstraintContext,
  ConstraintResult,
} from "@/features/core/constraint-engine/models"
import type {
  ConstraintCategory,
  ConstraintId,
  ConstraintPriority,
  ConstraintType,
} from "@/features/core/constraint-engine/types"

import type {
  ConstraintConfig,
  ParameterDefinition,
} from "@/features/core/constraint-catalog/types/parameters"

/**
 * ConstraintDefinition — the catalog entry for a constraint. It owns ALL of the
 * constraint's metadata (single source of truth) and knows how to build the
 * runtime `Constraint` from a configuration.
 *
 * The Planning Engine only ever sees definitions via the catalog; it never
 * imports a business constraint directly.
 */
export interface ConstraintDefinition {
  readonly id: ConstraintId
  readonly name: string
  readonly category: ConstraintCategory
  readonly description: string
  readonly priority: ConstraintPriority
  /** `hard` blocks feasibility; `soft` only warns. */
  readonly type: ConstraintType
  /** Whether the constraint is loaded unless a tenant disables it. */
  readonly enabledByDefault: boolean
  /** Whether the constraint accepts configuration parameters. */
  readonly configurable: boolean
  readonly parameters: readonly ParameterDefinition[]
  readonly tags: readonly string[]
  /** Semantic version of the definition, e.g. "1.0.0". */
  readonly version: string

  /** Build the runtime constraint with the given (optional) configuration. */
  create(config?: ConstraintConfig): Constraint
}

/**
 * Input to `defineConstraint`: the metadata plus the evaluation logic. The
 * evaluator factory receives resolved config and returns the pure decision
 * function — so metadata is declared exactly once.
 */
export interface ConstraintSpec {
  readonly id: ConstraintId
  readonly name: string
  readonly category: ConstraintCategory
  readonly description: string
  readonly priority: ConstraintPriority
  readonly type: ConstraintType
  readonly enabledByDefault: boolean
  readonly configurable: boolean
  readonly parameters: readonly ParameterDefinition[]
  readonly tags: readonly string[]
  readonly version: string
  readonly evaluate: (
    config: ConstraintConfig
  ) => (context: ConstraintContext) => ConstraintResult
}
