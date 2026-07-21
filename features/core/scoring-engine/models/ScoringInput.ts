import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"
import type { Coverage } from "@/features/core/demand-engine"

/**
 * ScoringInput — everything the scoring engine reads. It consumes ALREADY
 * COMPUTED artifacts and derives no domain facts of its own:
 *
 * - `report`   — the constraint engine's verdict (which constraints passed,
 *                warned or failed, and whether the planning is feasible);
 * - `coverage` — the demand engine's comparison of demand vs assignments,
 *                including its own `statistics`.
 *
 * The engine never touches Employees, Shifts, Assignments or a database: it
 * only converts these reports into a comparable score.
 */
export interface ScoringInput {
  readonly report: ConstraintEvaluationReport
  readonly coverage: Coverage
}
