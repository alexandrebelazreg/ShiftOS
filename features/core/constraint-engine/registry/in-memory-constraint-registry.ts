import type { Constraint } from "@/features/core/constraint-engine/models"
import type { ConstraintRegistry } from "@/features/core/constraint-engine/registry/constraint-registry"
import type {
  ConstraintCategory,
  ConstraintId,
} from "@/features/core/constraint-engine/types"

/**
 * Creates an in-memory `ConstraintRegistry` backed by a `Map`. O(1) register /
 * lookup; iteration order is insertion order (deterministic). Suitable for
 * hundreds of constraints. No evaluation logic lives here — it is pure storage.
 */
export function createConstraintRegistry(): ConstraintRegistry {
  const constraints = new Map<ConstraintId, Constraint>()

  return {
    register(constraint: Constraint): void {
      if (constraints.has(constraint.id)) {
        throw new Error(`Duplicate constraint id: ${constraint.id}`)
      }
      constraints.set(constraint.id, constraint)
    },
    unregister(id: ConstraintId): void {
      constraints.delete(id)
    },
    has(id: ConstraintId): boolean {
      return constraints.has(id)
    },
    get(id: ConstraintId): Constraint | undefined {
      return constraints.get(id)
    },
    all(): readonly Constraint[] {
      return [...constraints.values()]
    },
    byCategory(category: ConstraintCategory): readonly Constraint[] {
      return [...constraints.values()].filter((c) => c.category === category)
    },
    enabled(): readonly Constraint[] {
      return [...constraints.values()].filter((c) => c.enabled)
    },
    setEnabled(id: ConstraintId, enabled: boolean): void {
      const constraint = constraints.get(id)
      if (constraint) constraint.enabled = enabled
    },
  }
}
