import type { ConstraintRegistry } from "@/features/core/constraint-engine/registry"
import { createConstraintRegistry } from "@/features/core/constraint-engine/registry"

import type { ConstraintCatalog } from "@/features/core/constraint-catalog/catalog"
import type { ConstraintConfig } from "@/features/core/constraint-catalog/types"

export interface BuildRegistryOptions {
  /** Per-constraint parameter overrides, keyed by constraint id. */
  readonly config?: Readonly<Record<string, ConstraintConfig>>
}

/**
 * Instantiates the catalog's enabled definitions into an engine
 * `ConstraintRegistry` ready for the evaluator. This is the seam:
 *
 *   Catalog → buildRegistry → Registry → ConstraintEvaluator
 *
 * The evaluator never knows the constraints — only what the catalog produced.
 */
export function buildRegistry(
  catalog: ConstraintCatalog,
  options: BuildRegistryOptions = {}
): ConstraintRegistry {
  const registry = createConstraintRegistry()
  for (const definition of catalog.getEnabledConstraints()) {
    registry.register(definition.create(options.config?.[definition.id]))
  }
  return registry
}
