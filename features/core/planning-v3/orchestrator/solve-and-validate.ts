import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type {
  PlanningSolverOptionsV3,
  PlanningSolverResultV3,
} from "@/features/core/planning-v3/types/solver"
import type { PlanningValidationReportV3 } from "@/features/core/planning-v3/types/validation"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator/validate-solution"
import { solvePlanningProblemV3 } from "@/features/core/planning-v3/solver"

/**
 * Solve, then have the result audited — by a party that is neither.
 *
 * The solver never calls the validator and the validator never calls the
 * solver; this orchestrator sits above both and hands the output of one to the
 * other. That is the only arrangement in which the audit means anything: a
 * solver allowed to consult, configure or short-circuit its own auditor grades
 * its own homework.
 *
 * A blocking violation here is not a planning problem, it is a SOLVER BUG. The
 * solver claimed the schedule satisfies rules it demonstrably breaks, so the
 * result is downgraded and flagged rather than passed on.
 */

export interface AuditedSolutionV3 {
  readonly result: PlanningSolverResultV3
  /** Null when the solver returned no solution to audit. */
  readonly report: PlanningValidationReportV3 | null
  /**
   * True when the solver returned a solution the independent validator then
   * rejected. Always a defect in the solver, never in the problem.
   */
  readonly solverContradictedByValidator: boolean
}

export function solveAndValidatePlanningV3(
  problem: PlanningProblemV3,
  options: PlanningSolverOptionsV3 = {}
): AuditedSolutionV3 {
  const result = solvePlanningProblemV3(problem, options)
  if (result.solution === null) {
    return { result, report: null, solverContradictedByValidator: false }
  }

  const report = validatePlanningSolutionV3(problem, result.solution)
  return {
    result,
    report,
    solverContradictedByValidator: !report.validHardConstraints,
  }
}

/**
 * The gate a future `v3` engine version must pass before anything is shown.
 * A solution carrying one blocking violation may never be published.
 */
export function isPublishableV3(audited: AuditedSolutionV3): audited is AuditedSolutionV3 & {
  readonly report: PlanningValidationReportV3
  readonly result: PlanningSolverResultV3 & { readonly solution: PlanningSolutionV3 }
} {
  return audited.report !== null && audited.report.validHardConstraints
}
