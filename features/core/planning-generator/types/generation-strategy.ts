import type {
  Absence,
  AvailabilityRule,
  Constraint as EmployeeConstraintRecord,
  Contract,
  Employee,
  Holiday,
  Planning,
  Shift,
  Store,
  Assignment,
} from "@/features/core/models"

import type { ConstraintEvaluator, ConstraintRegistry } from "@/features/core/constraint-engine"
import type { Demand } from "@/features/core/demand-engine"
import type { GenerationSettings } from "@/features/core/planning-generator/types/generation-settings"
import type { AssignmentRanking } from "@/features/core/planning-generator/types/assignment-ranking"
import type { BusinessPlanningContext, PlanningExplanation, PlanningIssue, PipelinePhaseName, RepairAttemptStatistics } from "@/features/core/planning-generator/types/business-pipeline"
import type { WeeklyMinuteAllocation } from "@/features/core/planning-generator/pipeline/weekly-minute-allocator"

/**
 * GenerationContext — the read-only problem a strategy assigns over. The
 * generator prepares it (empty planning + normalized collections + the shared
 * constraint evaluator/registry) and hands it to the strategy. A strategy READS
 * this; it never mutates the inputs.
 */
export interface GenerationContext {
  readonly store: Store
  readonly employees: readonly Employee[]
  readonly demand: Demand
  readonly settings: GenerationSettings

  /** The empty planning to populate. */
  readonly planning: Planning

  /** Constraints to respect — the strategy filters candidates through these. */
  readonly registry: ConstraintRegistry
  readonly evaluator: ConstraintEvaluator

  // Context the constraint engine needs to reach a verdict.
  readonly contracts: readonly Contract[]
  readonly availabilityRules: readonly AvailabilityRule[]
  readonly absences: readonly Absence[]
  readonly holidays: readonly Holiday[]
  readonly employeeConstraints: readonly EmployeeConstraintRecord[]
  readonly business: BusinessPlanningContext
}

/**
 * GenerationPlan — what a strategy produces: the shifts and assignments that
 * make up the planning, plus how many candidate placements it rejected and how
 * many constraint evaluations it ran (for the generation statistics). The
 * strategy assigns; it does not evaluate the final planning — the generator
 * does that uniformly for every strategy.
 */
export interface GenerationPlan {
  readonly shifts: readonly Shift[]
  readonly assignments: readonly Assignment[]
  readonly candidatesRejectedByHardConstraints: number
  readonly constraintEvaluations: number
  /**
   * Why each assignment was chosen (ranking breakdown + rejected alternatives).
   * Empty for strategies that do not rank. Structured explainability, no UI.
   */
  readonly assignmentRankings: readonly AssignmentRanking[]
  readonly explanations?: readonly PlanningExplanation[]
  readonly issues?: readonly PlanningIssue[]
  readonly phaseTrace?: readonly PipelinePhaseName[]
  readonly repairAttempts?: readonly RepairAttemptStatistics[]
  readonly weeklyAllocation?: WeeklyMinuteAllocation
}

/**
 * GenerationStrategy — the pluggable algorithm that turns demand into
 * assignments. Implementations hold NO business rules; they orchestrate the
 * injected engines. Adding a strategy is a new implementation of this interface
 * — the generator and the evaluation pipeline never change.
 */
export interface GenerationStrategy {
  readonly name: string
  generate(context: GenerationContext): GenerationPlan
}
