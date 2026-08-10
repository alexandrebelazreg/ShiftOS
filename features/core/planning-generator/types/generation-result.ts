import type { Assignment, Planning, Shift } from "@/features/core/models"

import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"
import type { Coverage } from "@/features/core/demand-engine"
import type { FairnessReport } from "@/features/core/fairness-engine"
import type { PlanningScore } from "@/features/core/scoring-engine"

/**
 * PlanningEvaluationResult — the verdict of every evaluation engine on one
 * schedule.
 *
 * It used to be `PlanningGenerationResult`, the output of the V2 pipeline, and
 * carried that pipeline's own bookkeeping alongside the verdicts: ranking
 * explanations, phase traces, repair statistics, the weekly minute allocation.
 * All of it described HOW V2 built a week, and all of it went with V2.
 *
 * What is left is the part that describes a week rather than the making of one,
 * which is why the editor's live indicators are built on it and why it survives
 * an engine change.
 */
export interface PlanningEvaluationResult {
  readonly planning: Planning
  /** Shifts hosting the assignments. */
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
}
