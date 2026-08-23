import type {
  ConstraintCategory,
  ConstraintId,
} from "@/features/core/constraint-engine/types"

import type { ConstraintDefinition } from "@/features/core/constraint-catalog/types"

/**
 * ConstraintCatalog — the official source of every constraint available in
 * Planiteo. The Planning Engine knows only the catalog; it never imports a
 * business constraint directly.
 */
export interface ConstraintCatalog {
  /** Register a definition. Rejects a duplicate id. */
  registerConstraint(definition: ConstraintDefinition): void
  getConstraint(id: ConstraintId): ConstraintDefinition | undefined
  getConstraints(): readonly ConstraintDefinition[]
  getConstraintsByCategory(
    category: ConstraintCategory
  ): readonly ConstraintDefinition[]
  /** Definitions enabled by default — the set loaded for evaluation. */
  getEnabledConstraints(): readonly ConstraintDefinition[]
}

/**
 * Creates an empty in-memory catalog. Insertion order is preserved
 * (deterministic). Constraint definitions are registered via packs.
 */
export function createConstraintCatalog(): ConstraintCatalog {
  const definitions = new Map<ConstraintId, ConstraintDefinition>()

  return {
    registerConstraint(definition: ConstraintDefinition): void {
      if (definitions.has(definition.id)) {
        throw new Error(`Duplicate constraint definition: ${definition.id}`)
      }
      definitions.set(definition.id, definition)
    },
    getConstraint(id: ConstraintId): ConstraintDefinition | undefined {
      return definitions.get(id)
    },
    getConstraints(): readonly ConstraintDefinition[] {
      return [...definitions.values()]
    },
    getConstraintsByCategory(
      category: ConstraintCategory
    ): readonly ConstraintDefinition[] {
      return [...definitions.values()].filter((d) => d.category === category)
    },
    getEnabledConstraints(): readonly ConstraintDefinition[] {
      return [...definitions.values()].filter((d) => d.enabledByDefault)
    },
  }
}
