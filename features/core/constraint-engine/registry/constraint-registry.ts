import type { Constraint } from "@/features/core/constraint-engine/models"
import type {
  ConstraintCategory,
  ConstraintId,
} from "@/features/core/constraint-engine/types"

/**
 * The constraint registry — the catalogue of constraints known to the engine.
 *
 * This is the mechanism that lets constraints be added WITHOUT modifying the
 * engine: register a constraint here and the evaluator will run it. The
 * evaluator reads from the registry; it never hard-codes any constraint (no
 * switch/case, no if/else chain).
 */
export interface ConstraintRegistry {
  /** Add a constraint. Implementations reject a duplicate `id`. */
  register(constraint: Constraint): void
  /** Remove a constraint by id. */
  unregister(id: ConstraintId): void

  has(id: ConstraintId): boolean
  get(id: ConstraintId): Constraint | undefined

  /** Every registered constraint, enabled or not. */
  all(): readonly Constraint[]
  /** Registered constraints in a given category. */
  byCategory(category: ConstraintCategory): readonly Constraint[]
  /** Only the constraints currently enabled — the set the evaluator runs. */
  enabled(): readonly Constraint[]

  /** Toggle a constraint on or off without unregistering it. */
  setEnabled(id: ConstraintId, enabled: boolean): void
}
