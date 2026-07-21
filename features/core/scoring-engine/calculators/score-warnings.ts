import type { Coverage } from "@/features/core/demand-engine"

import type { DimensionScore, ScoreWarning } from "@/features/core/scoring-engine/models"
import { toPercent } from "@/features/core/scoring-engine/utils"

/** The dimension scores a warning build reads from. */
interface WarningSources {
  readonly feasible: boolean
  readonly coverage: Coverage
  readonly hard: DimensionScore
  readonly soft: DimensionScore
  readonly contract: DimensionScore
  readonly availability: DimensionScore
}

/**
 * Build the human-readable warnings for a score, in a stable, deterministic
 * order (feasibility first, then coverage, then category deviations, then a
 * generic soft note). Every warning explains a concrete reason points were
 * lost — the engine must always be able to justify a score.
 */
export function buildWarnings(sources: WarningSources): readonly ScoreWarning[] {
  const { feasible, coverage, hard, soft, contract, availability } = sources
  const stats = coverage.statistics
  const warnings: ScoreWarning[] = []

  if (!feasible) {
    warnings.push({
      code: "infeasible",
      severity: "blocking",
      message: `${hard.failed} hard constraint(s) failed — planning is infeasible.`,
    })
  }

  if (stats.underCovered > 0) {
    warnings.push({
      code: "coverage_gap",
      severity: "major",
      message: `${stats.underCovered} requirement(s) under-covered (coverage ${toPercent(
        stats.overallCoveragePercentage
      )}).`,
    })
  }

  if (stats.requirementsWithMissingCapabilities > 0) {
    warnings.push({
      code: "missing_capabilities",
      severity: "major",
      message: `${stats.requirementsWithMissingCapabilities} requirement(s) missing required capabilities.`,
    })
  }

  if (stats.overCovered > 0) {
    warnings.push({
      code: "coverage_gap",
      severity: "minor",
      message: `${stats.overCovered} requirement(s) over-covered.`,
    })
  }

  if (availability.failed > 0) {
    warnings.push({
      code: "availability_conflict",
      severity: "blocking",
      message: `${availability.failed} availability conflict(s).`,
    })
  }

  const contractUnsatisfied = contract.failed + contract.warned
  if (contractUnsatisfied > 0) {
    warnings.push({
      code: "contract_deviation",
      severity: contract.failed > 0 ? "major" : "minor",
      message: `${contractUnsatisfied} contract rule(s) not fully satisfied.`,
    })
  }

  const softUnsatisfied = soft.failed + soft.warned
  if (softUnsatisfied > 0) {
    warnings.push({
      code: "soft_violations",
      severity: "minor",
      message: `${softUnsatisfied} soft constraint(s) not fully satisfied.`,
    })
  }

  return warnings
}
