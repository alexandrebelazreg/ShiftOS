import type { Assignment, Employee, Planning } from "@/features/core/models"

import type { EmployeeStatistics } from "@/features/core/statistics-engine"

/**
 * FairnessInput — everything the fairness engine reads. It ANALYZES; it never
 * modifies a planning and derives no raw facts of its own.
 *
 * - `planning`    — the schedule under analysis (provides the period + scope).
 * - `employees`   — the COHORT fairness is measured across. Crucial: employees
 *                   with no assignments still count (they are the ones who got
 *                   nothing), so they must be listed here even if absent from
 *                   `statistics`. Only `active` employees are considered.
 * - `assignments` — the planning's assignments; context for custom calculators.
 * - `statistics`  — pre-aggregated per-employee metrics (worked minutes,
 *                   openings, closings, …), the authoritative value source for
 *                   the shipped dimensions.
 */
export interface FairnessInput {
  readonly planning: Planning
  readonly employees: readonly Employee[]
  readonly assignments: readonly Assignment[]
  readonly statistics: readonly EmployeeStatistics[]
}
