import type { RankingDimension } from "@/features/core/planning-generator/ranking/ranking-types"
import { contractBalanceDimension } from "@/features/core/planning-generator/ranking/contract-balance-dimension"
import { fairnessDimension } from "@/features/core/planning-generator/ranking/fairness-dimension"
import { currentWorkloadDimension } from "@/features/core/planning-generator/ranking/current-workload-dimension"

/**
 * The ranking dimensions shipped in this sprint, in a deterministic order.
 *
 * THIS ARRAY IS THE EXTENSION POINT: to add a future ranking dimension, write a
 * `RankingDimension` and add it here — the ranker and the strategy are untouched.
 * (Availability is intentionally absent: it is the admissibility GATE, so only
 * compatible employees ever reach ranking.)
 */
export const DEFAULT_RANKING_DIMENSIONS: readonly RankingDimension[] = [
  contractBalanceDimension,
  fairnessDimension,
  currentWorkloadDimension,
]
