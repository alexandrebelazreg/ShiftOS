import type { ConstraintRegistry } from "@/features/core/constraint-engine"
import {
  availabilityConstraint,
  contractHoursConstraint,
  coverageConstraint,
  createConstraintRegistry,
} from "@/features/core/constraint-engine"

import type { StoreConfiguration } from "@/features/store/models"

/**
 * Build the constraint registry the engine runs, configured from the store.
 * Each built-in constraint is registered with the store's values — coverage
 * minimum and contract tolerance come straight from the configuration, so no
 * threshold is hardcoded in the engine or duplicated here.
 */
export function toConstraintRegistry(config: StoreConfiguration): ConstraintRegistry {
  const registry = createConstraintRegistry()
  registry.register(
    coverageConstraint({ minAssignmentsPerShift: config.coverage.defaultMinEmployeesPerShift })
  )
  registry.register(availabilityConstraint())
  registry.register(
    contractHoursConstraint({ toleranceMinutes: config.shift.contractToleranceMinutes })
  )
  return registry
}
