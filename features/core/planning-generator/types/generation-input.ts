import type {
  Absence,
  AvailabilityRule,
  Constraint as EmployeeConstraintRecord,
  Contract,
  Employee,
  Holiday,
  Store,
} from "@/features/core/models"

import type { ConstraintRegistry } from "@/features/core/constraint-engine"
import type { Demand } from "@/features/core/demand-engine"
import type { GenerationSettings } from "@/features/core/planning-generator/types/generation-settings"
import type { BusinessPlanningContext } from "@/features/core/planning-generator/types/business-pipeline"

/**
 * PlanningGenerationInput — everything the generator needs. It maps the sprint's
 * five inputs (Store, Employees, Demand, Constraints, Planning Settings) plus
 * the domain data the EXISTING engines require to evaluate a planning.
 *
 * `registry` is the "Constraints" input: a `ConstraintRegistry` the caller
 * populates (e.g. via `registerBuiltInConstraints`). The generator never knows
 * which constraints it holds — it only runs them. Availability, contract limits
 * and coverage are therefore enforced entirely by the registry, not by the
 * generator.
 *
 * The availability-supporting collections (`contracts`, `availabilityRules`,
 * `absences`, `holidays`, `employeeConstraints`) are the context the constraint
 * engine reads; each defaults to empty when a caller has none.
 */
export interface PlanningGenerationInput {
  readonly store: Store
  readonly employees: readonly Employee[]
  readonly demand: Demand
  readonly registry: ConstraintRegistry
  readonly settings: GenerationSettings

  readonly contracts?: readonly Contract[]
  readonly availabilityRules?: readonly AvailabilityRule[]
  readonly absences?: readonly Absence[]
  readonly holidays?: readonly Holiday[]
  /** Core employee-constraint records (fixed day off / forbidden day, …). */
  readonly employeeConstraints?: readonly EmployeeConstraintRecord[]
  /** Optional app-supplied business metadata not owned by the Data Bridge. */
  readonly business?: BusinessPlanningContext
}
