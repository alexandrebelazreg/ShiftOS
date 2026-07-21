import type {
  PlanningScore,
  ScoringInput,
} from "@/features/core/scoring-engine/models"
import type { ScoringPolicy } from "@/features/core/scoring-engine/policies"
import { DEFAULT_SCORING_POLICY } from "@/features/core/scoring-engine/policies"
import { hardScore } from "@/features/core/scoring-engine/calculators/hard-score-calculator"
import { softScore } from "@/features/core/scoring-engine/calculators/soft-score-calculator"
import { coverageScore } from "@/features/core/scoring-engine/calculators/coverage-score-calculator"
import { contractScore } from "@/features/core/scoring-engine/calculators/contract-score-calculator"
import { availabilityScore } from "@/features/core/scoring-engine/calculators/availability-score-calculator"
import { buildWarnings } from "@/features/core/scoring-engine/calculators/score-warnings"
import { clamp01, round, weightedAverage } from "@/features/core/scoring-engine/utils"

/** Normalized weights of the quality blend (sum to 1, or all-equal fallback). */
interface NormalizedWeights {
  readonly coverage: number
  readonly contract: number
  readonly availability: number
  readonly soft: number
}

function normalizeWeights(policy: ScoringPolicy): NormalizedWeights {
  const { coverage, contract, availability, soft } = policy.weights
  const total = coverage + contract + availability + soft
  if (total <= 0) {
    return { coverage: 0.25, contract: 0.25, availability: 0.25, soft: 0.25 }
  }
  return {
    coverage: coverage / total,
    contract: contract / total,
    availability: availability / total,
    soft: soft / total,
  }
}

/**
 * ScoringEngine — converts constraint evaluation and coverage into a comparable
 * `PlanningScore`. It only SCORES: no schedule generation, no optimization, no
 * I/O. Pure and deterministic — the same input always yields the same output.
 */
export interface ScoringEngine {
  score(input: ScoringInput, policy?: ScoringPolicy): PlanningScore
}

export const scoringEngine: ScoringEngine = {
  score(
    input: ScoringInput,
    policy: ScoringPolicy = DEFAULT_SCORING_POLICY
  ): PlanningScore {
    const { report, coverage } = input
    const weights = normalizeWeights(policy)

    // --- Dimension scores -------------------------------------------------
    const hard = hardScore(report, policy)
    const soft = softScore(report, weights.soft, policy)
    const cov = coverageScore(coverage, weights.coverage)
    const contract = contractScore(report, weights.contract, policy)
    const availability = availabilityScore(report, weights.availability, policy)

    // --- Quality blend (soft quality, feasibility-agnostic) ---------------
    const quality = clamp01(
      weightedAverage([
        [cov.score, weights.coverage],
        [contract.score, weights.contract],
        [availability.score, weights.availability],
        [soft.score, weights.soft],
      ])
    )

    // --- Feasibility gate -------------------------------------------------
    // The report is authoritative on feasibility; we also guard on the hard
    // tally so the two can never disagree.
    const feasible = report.feasible && hard.failed === 0
    const threshold = policy.feasibilityThreshold

    // A feasible planning lives in [threshold, 1]; an infeasible one in
    // [0, threshold). Because an infeasible planning has hard.score < 1, its
    // overall (threshold * hard.score) is strictly below threshold, so soft
    // quality can NEVER lift it into feasible territory.
    const overall = feasible
      ? round(clamp01(threshold + (1 - threshold) * quality))
      : round(clamp01(threshold * hard.score))

    const warnings = buildWarnings({
      feasible,
      coverage,
      hard,
      soft,
      contract,
      availability,
    })

    return {
      overall,
      feasible,
      hard,
      soft,
      coverage: cov,
      contract,
      availability,
      warnings,
      details: {
        quality: round(quality),
        feasibilityThreshold: threshold,
        hardConstraintsTotal: hard.evaluated,
        hardConstraintsFailed: hard.failed,
        softConstraintsTotal: soft.evaluated,
        softConstraintsUnsatisfied: soft.warned + soft.failed,
        coverage: {
          totalRequirements: coverage.statistics.totalRequirements,
          covered: coverage.statistics.covered,
          underCovered: coverage.statistics.underCovered,
          overCovered: coverage.statistics.overCovered,
          requirementsWithMissingCapabilities:
            coverage.statistics.requirementsWithMissingCapabilities,
          overallCoveragePercentage: round(
            clamp01(coverage.statistics.overallCoveragePercentage)
          ),
        },
        dimensions: [hard, soft, cov, contract, availability],
        evaluatedAt: report.evaluatedAt,
      },
    }
  },
}
