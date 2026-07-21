import {
  contractHoursConstraintDefinition,
  type ContractHoursConstraintConfig,
} from "@/features/core/constraint-catalog/metadata/contract-hours-constraint"
import type { ConstraintConfig } from "@/features/core/constraint-catalog/types"
import type { Constraint } from "@/features/core/constraint-engine/models"

export type { ContractHoursConstraintConfig }

/**
 * Runtime factory for the contract-hours constraint. Delegates to the catalog
 * definition, the single source of the constraint's metadata and logic.
 */
export function contractHoursConstraint(
  config: ContractHoursConstraintConfig = {}
): Constraint {
  return contractHoursConstraintDefinition.create(config as ConstraintConfig)
}
