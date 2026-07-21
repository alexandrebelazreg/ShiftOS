import type { FairnessDimensionCalculator } from "@/features/core/fairness-engine/calculators/fairness-dimension-calculator"
import { workedHoursFairness } from "@/features/core/fairness-engine/calculators/worked-hours-fairness"
import { openingFairness } from "@/features/core/fairness-engine/calculators/opening-fairness"
import { closingFairness } from "@/features/core/fairness-engine/calculators/closing-fairness"
import { splitShiftFairness } from "@/features/core/fairness-engine/calculators/split-shift-fairness"
import { weekendFairness } from "@/features/core/fairness-engine/calculators/weekend-fairness"
import { createFairnessRegistry } from "@/features/core/fairness-engine/registry/in-memory-fairness-registry"
import type { FairnessRegistry } from "@/features/core/fairness-engine/registry/fairness-registry"

/**
 * The dimensions shipped with the engine, in a deterministic order. Each is
 * backed by a field of `EmployeeStatistics`.
 *
 * THIS ARRAY IS THE "ONE REGISTRATION". To add a fairness dimension: write one
 * calculator and add it here. Nothing else in the engine changes.
 */
export const DEFAULT_FAIRNESS_DIMENSIONS: readonly FairnessDimensionCalculator[] = [
  workedHoursFairness,
  openingFairness,
  closingFairness,
  splitShiftFairness,
  weekendFairness,
]

/** A fresh registry pre-loaded with the shipped dimensions. */
export function createDefaultFairnessRegistry(): FairnessRegistry {
  const registry = createFairnessRegistry()
  for (const calculator of DEFAULT_FAIRNESS_DIMENSIONS) {
    registry.register(calculator)
  }
  return registry
}
