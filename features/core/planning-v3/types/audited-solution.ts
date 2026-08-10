import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type { PlanningSolverResultV3 } from "@/features/core/planning-v3/types/solver"
import type { PlanningValidationReportV3 } from "@/features/core/planning-v3/types/validation"

/**
 * A solver's answer, together with the verdict of a party that is neither the
 * solver nor the caller.
 *
 * The engine never calls the validator and the validator never calls the
 * engine; whoever runs them hands the output of one to the other. That is the
 * only arrangement in which the audit means anything — a solver allowed to
 * consult, configure or short-circuit its own auditor grades its own homework.
 *
 * A blocking violation here is not a planning problem, it is an ENGINE BUG: the
 * engine claimed a schedule satisfies rules it demonstrably breaks, so the
 * result is downgraded and flagged rather than passed on.
 *
 * The shape used to live in an orchestrator that also ran the in-process
 * TypeScript solver. That solver was deleted; the shape stays, because the
 * remaining engine produces exactly this and the adapters translate exactly
 * this.
 */
export interface AuditedSolutionV3 {
  readonly result: PlanningSolverResultV3
  /** Null when the engine returned no solution to audit. */
  readonly report: PlanningValidationReportV3 | null
  /**
   * True when the engine returned a solution the independent validator then
   * rejected. Always a defect in the engine, never in the problem.
   */
  readonly solverContradictedByValidator: boolean
}

/** A solution carrying one blocking violation may never be published. */
export function isPublishableV3(audited: AuditedSolutionV3): audited is AuditedSolutionV3 & {
  readonly report: PlanningValidationReportV3
  readonly result: PlanningSolverResultV3 & { readonly solution: PlanningSolutionV3 }
} {
  return audited.report !== null && audited.report.validHardConstraints
}
