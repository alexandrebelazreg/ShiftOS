import type { ConstraintPack } from "@/features/core/constraint-catalog/types"
import { availabilityConstraintDefinition } from "@/features/core/constraint-catalog/metadata/availability-constraint"
import { contractHoursConstraintDefinition } from "@/features/core/constraint-catalog/metadata/contract-hours-constraint"
import { coverageConstraintDefinition } from "@/features/core/constraint-catalog/metadata/coverage-constraint"

export * from "@/features/core/constraint-catalog/metadata/coverage-constraint"
export * from "@/features/core/constraint-catalog/metadata/availability-constraint"
export * from "@/features/core/constraint-catalog/metadata/contract-hours-constraint"

/**
 * The built-in constraints shipped by Core, expressed as a pack — exactly like
 * a future Retail or Hospital pack. Nothing else references the definitions by
 * name; they are loaded through the catalog.
 */
export const coreConstraintPack: ConstraintPack = {
  name: "core",
  version: "1.0.0",
  definitions: [
    coverageConstraintDefinition,
    availabilityConstraintDefinition,
    contractHoursConstraintDefinition,
  ],
}
