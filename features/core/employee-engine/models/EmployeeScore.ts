import type { EmployeeId } from "@/features/core/models"

/**
 * EmployeeScore — per-employee scoring dimensions used by the planning engine
 * for equitable and informed decisions.
 *
 * Distinct from the planning-level score in `constraint-engine/scoring`: this
 * describes ONE employee, not a whole planning. Each dimension is normalized to
 * `[0, 1]` (higher is better).
 */
export interface EmployeeScore {
  readonly employeeId: EmployeeId
  /** How equitably this employee has been treated relative to peers. */
  readonly fairness: number
  /** Accumulated experience / seniority signal. */
  readonly experience: number

  // TODO: additional dimensions (reliability, versatility) once defined.
}
