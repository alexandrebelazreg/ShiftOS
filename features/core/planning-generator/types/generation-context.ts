import type {
  Absence,
  AvailabilityRule,
  Constraint as EmployeeConstraintRecord,
  Contract,
  Employee,
  Holiday,
  Planning,
  Store,
} from "@/features/core/models"

import type { ConstraintEvaluator, ConstraintRegistry } from "@/features/core/constraint-engine"
import type { Demand } from "@/features/core/demand-engine"
import type { GenerationSettings } from "@/features/core/planning-generator/types/generation-settings"
import type { BusinessPlanningContext } from "@/features/core/planning-generator/types/business-pipeline"

/**
 * GenerationContext — the read-only problem an EVALUATION reads over.
 *
 * It used to be what a generation strategy assigned over. The strategies and
 * the V2 pipeline are gone; what survives is the half the constraint engine
 * still needs to reach a verdict on a schedule someone else produced, which is
 * what the editor's live indicators run on.
 *
 * Nothing here mutates: a reader of this context evaluates, it never assigns.
 */
export interface GenerationContext {
  readonly store: Store
  readonly employees: readonly Employee[]
  readonly demand: Demand
  readonly settings: GenerationSettings

  /** The planning being evaluated. */
  readonly planning: Planning

  /** Constraints to respect — the evaluation runs candidates through these. */
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
