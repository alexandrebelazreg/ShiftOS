import { clamp01 } from "@/features/core/fairness-engine"

import type { RankingDimension } from "@/features/core/planning-generator/ranking/ranking-types"

/**
 * Fairness — prefer employees with the LOWEST fairness debt. The debt itself is
 * produced by the existing Fairness Engine (see `computeFairnessLoad`); this
 * dimension only reads the precomputed load, so no fairness calculation is
 * duplicated. Score = `1 - load`.
 */
export const fairnessDimension: RankingDimension = {
  name: "fairness",
  weight: 0.3,
  score(employeeId, context) {
    const load = context.fairnessLoadByEmployee.get(employeeId) ?? 0
    return clamp01(1 - load)
  },
}
