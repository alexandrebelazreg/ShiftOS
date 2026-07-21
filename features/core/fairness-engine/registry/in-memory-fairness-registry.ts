import type { FairnessDimension } from "@/features/core/fairness-engine/types"
import type { FairnessDimensionCalculator } from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"
import type { FairnessRegistry } from "@/features/core/fairness-engine/registry/fairness-registry"

/**
 * Creates an in-memory `FairnessRegistry` backed by a `Map`. O(1) register /
 * lookup; iteration order is insertion order (deterministic). Pure storage — no
 * measurement logic lives here.
 */
export function createFairnessRegistry(): FairnessRegistry {
  const calculators = new Map<FairnessDimension, FairnessDimensionCalculator>()

  return {
    register(calculator: FairnessDimensionCalculator): void {
      if (calculators.has(calculator.dimension)) {
        throw new Error(`Duplicate fairness dimension: ${calculator.dimension}`)
      }
      calculators.set(calculator.dimension, calculator)
    },
    unregister(dimension: FairnessDimension): void {
      calculators.delete(dimension)
    },
    has(dimension: FairnessDimension): boolean {
      return calculators.has(dimension)
    },
    get(dimension: FairnessDimension): FairnessDimensionCalculator | undefined {
      return calculators.get(dimension)
    },
    all(): readonly FairnessDimensionCalculator[] {
      return [...calculators.values()]
    },
  }
}
