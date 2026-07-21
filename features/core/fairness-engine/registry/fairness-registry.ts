import type { FairnessDimension } from "@/features/core/fairness-engine/types"
import type { FairnessDimensionCalculator } from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"

/**
 * The fairness registry — the catalogue of dimension calculators the engine
 * measures. This is the mechanism that lets dimensions be added WITHOUT
 * modifying the engine: register a calculator here and the engine will score
 * it. The engine reads from the registry; it never hard-codes a dimension (no
 * switch/case).
 */
export interface FairnessRegistry {
  /** Add a calculator. Implementations reject a duplicate `dimension`. */
  register(calculator: FairnessDimensionCalculator): void
  /** Remove a calculator by dimension. */
  unregister(dimension: FairnessDimension): void

  has(dimension: FairnessDimension): boolean
  get(dimension: FairnessDimension): FairnessDimensionCalculator | undefined

  /** Every registered calculator, in registration order (deterministic). */
  all(): readonly FairnessDimensionCalculator[]
}
