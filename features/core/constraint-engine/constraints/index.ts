import type { ConstraintRegistry } from "@/features/core/constraint-engine/registry"
import { availabilityConstraint } from "@/features/core/constraint-engine/constraints/availability-constraint"
import { contractHoursConstraint } from "@/features/core/constraint-engine/constraints/contract-hours-constraint"
import { coverageConstraint } from "@/features/core/constraint-engine/constraints/coverage-constraint"

export * from "@/features/core/constraint-engine/constraints/coverage-constraint"
export * from "@/features/core/constraint-engine/constraints/availability-constraint"
export * from "@/features/core/constraint-engine/constraints/contract-hours-constraint"

/**
 * Registers the built-in constraints with their default configuration. Adding a
 * new constraint to the engine is: create its file, then add one `register`
 * line here (or register it from a business pack) — nothing else.
 */
export function registerBuiltInConstraints(registry: ConstraintRegistry): void {
  registry.register(coverageConstraint())
  registry.register(availabilityConstraint())
  registry.register(contractHoursConstraint())
}
