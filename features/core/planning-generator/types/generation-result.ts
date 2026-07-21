import type { Assignment, Planning, Shift } from "@/features/core/models"

import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"
import type { Coverage } from "@/features/core/demand-engine"
import type { FairnessReport } from "@/features/core/fairness-engine"
import type { PlanningScore } from "@/features/core/scoring-engine"
import type { GenerationStatistics } from "@/features/core/planning-generator/types/generation-statistics"
import type { AssignmentRanking } from "@/features/core/planning-generator/types/assignment-ranking"
import type { PlanningExplanation, PlanningIssue, PipelinePhaseName, RepairAttemptStatistics } from "@/features/core/planning-generator/types/business-pipeline"
import type { WeeklyMinuteAllocation } from "@/features/core/planning-generator/pipeline/weekly-minute-allocator"

/**
 * PlanningGenerationResult — the complete output of a generation run. It bundles
 * the generated planning with the verdict of EVERY downstream engine, so a
 * caller gets one artifact to display, compare or persist.
 *
 * Nothing here is recomputed by the generator: each field is produced by the
 * engine that owns it (constraint / demand / fairness / scoring).
 */
export interface PlanningGenerationResult {
  readonly planning: Planning
  /** Shifts created to host the assignments. */
  readonly shifts: readonly Shift[]
  readonly assignments: readonly Assignment[]

  /** Constraint Engine verdict. */
  readonly constraintReport: ConstraintEvaluationReport
  /** Demand Engine coverage report. */
  readonly coverage: Coverage
  /** Fairness Engine report. */
  readonly fairness: FairnessReport
  /** Scoring Engine structured score. */
  readonly score: PlanningScore

  readonly statistics: GenerationStatistics
  /** Per-assignment ranking explanations (empty for non-ranking strategies). */
  readonly assignmentRankings: readonly AssignmentRanking[]
  readonly status: "complete" | "degraded" | "blocked"
  readonly explanations: readonly PlanningExplanation[]
  readonly issues: readonly PlanningIssue[]
  readonly phaseTrace: readonly PipelinePhaseName[]
  readonly repairAttempts: readonly RepairAttemptStatistics[]
  readonly weeklyAllocation: WeeklyMinuteAllocation | null
}
