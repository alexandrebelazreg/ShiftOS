import { availabilityConstraintDefinition } from "@/features/core/constraint-catalog/metadata/availability-constraint"
import type { Constraint } from "@/features/core/constraint-engine/models"

/**
 * Runtime factory for the availability constraint. Delegates to the catalog
 * definition, the single source of the constraint's metadata and logic.
 */
export function availabilityConstraint(): Constraint {
  return availabilityConstraintDefinition.create()
}
