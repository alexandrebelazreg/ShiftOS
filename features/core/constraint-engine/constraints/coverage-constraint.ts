import {
  coverageConstraintDefinition,
  type CoverageConstraintConfig,
} from "@/features/core/constraint-catalog/metadata/coverage-constraint"
import type { ConstraintConfig } from "@/features/core/constraint-catalog/types"
import type { Constraint } from "@/features/core/constraint-engine/models"

export type { CoverageConstraintConfig }

/**
 * Runtime factory for the coverage constraint. Delegates to the catalog
 * definition, the single source of the constraint's metadata and logic.
 */
export function coverageConstraint(
  config: CoverageConstraintConfig = {}
): Constraint {
  return coverageConstraintDefinition.create(config as ConstraintConfig)
}
