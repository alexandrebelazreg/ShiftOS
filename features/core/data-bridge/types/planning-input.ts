import type {
  Absence,
  AvailabilityRule,
  Constraint as EmployeeConstraintRecord,
  Contract,
  Employee,
  Holiday,
  Store,
} from "@/features/core/models"
import type { Demand } from "@/features/core/demand-engine"

/**
 * PlanningInput — the bridge's output: CORE MODELS ONLY, the domain-data bundle
 * a planning run needs. It carries no engine config (registry / settings) — that
 * comes from the store configuration module — and no computed values. It is the
 * clean boundary the Planning Generator consumes: the generator never sees an
 * app model.
 *
 * `employeeConstraints` are core `Constraint` records (fixed day off, forbidden
 * day, max openings/closings) translated from the flat employee records.
 */
export interface PlanningInput {
  readonly store: Store
  readonly employees: readonly Employee[]
  readonly contracts: readonly Contract[]
  readonly availabilityRules: readonly AvailabilityRule[]
  readonly absences: readonly Absence[]
  readonly employeeConstraints: readonly EmployeeConstraintRecord[]
  readonly holidays: readonly Holiday[]
  readonly demand: Demand
}
