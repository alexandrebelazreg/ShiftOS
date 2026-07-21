import type { Employee } from "@/features/core/models"

import { clamp01, round } from "@/features/core/fairness-engine"
import type { RankedCandidate } from "@/features/core/planning-generator/types/assignment-ranking"
import type {
  RankingContext,
  RankingDimension,
} from "@/features/core/planning-generator/ranking/ranking-types"

/**
 * Rank the compatible candidates by a WEIGHTED BLEND of the ranking dimensions,
 * best first. Each candidate's score is the weight-normalized average of the
 * dimension scores, with a full per-dimension breakdown kept for explainability.
 *
 * Deterministic: ties are broken by employee id, so identical inputs always
 * yield the same order (and the same "best" candidate).
 */
export function rankCandidates(
  employees: readonly Employee[],
  context: RankingContext,
  dimensions: readonly RankingDimension[]
): RankedCandidate[] {
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0)

  const ranked = employees.map((employee): RankedCandidate => {
    let weightedTotal = 0
    const contributions = dimensions.map((dimension) => {
      const rawScore = clamp01(dimension.score(employee.id, context))
      const weightedScore = rawScore * dimension.weight
      weightedTotal += weightedScore
      return {
        dimension: dimension.name,
        weight: dimension.weight,
        rawScore: round(rawScore),
        weightedScore: round(weightedScore),
      }
    })
    const score = totalWeight > 0 ? round(weightedTotal / totalWeight) : 0
    return { employeeId: employee.id, score, contributions }
  })

  return ranked.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.employeeId < b.employeeId ? -1 : 1
  )
}
