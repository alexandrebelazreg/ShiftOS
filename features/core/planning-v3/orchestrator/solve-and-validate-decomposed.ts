import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator/validate-solution"
import { solveDecomposed } from "@/features/core/planning-v3/solver-decomposed"
import type {
  DecomposedOptions,
  DecomposedRunReport,
} from "@/features/core/planning-v3/solver-decomposed"

import type { AuditedSolutionV3 } from "@/features/core/planning-v3/orchestrator/solve-and-validate"

/**
 * Solve with the decomposed engine, then have the result audited — by a party
 * that is neither.
 *
 * The same arrangement as `solve-and-validate`, for the same reason: the engine
 * never calls the validator and the validator never calls the engine, and this
 * module sits above both. It is the ONLY place the two meet, which is what
 * makes the audit worth anything. `__tests__/import-boundaries.test.ts` asserts
 * that no solver source imports the validator, so the arrangement is enforced
 * rather than merely intended.
 *
 * A blocking violation reported here is a DEFECT IN THE ENGINE, not a hard
 * week: the engine claimed a schedule satisfying rules the validator can
 * demonstrate it breaks. That is surfaced through
 * `solverContradictedByValidator`, and the contract's invariants turn it into a
 * backend error rather than a verdict about the business.
 *
 * The run report travels alongside the audit rather than inside it. It is
 * telemetry — phase timings, counters, assumed rules — and folding it into the
 * shared `AuditedSolutionV3` would push engine internals into a type every
 * other engine has to satisfy.
 */
export interface AuditedDecomposedSolution {
  readonly audited: AuditedSolutionV3
  readonly report: DecomposedRunReport
}

export function solveAndValidateDecomposedV3(
  problem: PlanningProblemV3,
  options: DecomposedOptions = {}
): AuditedDecomposedSolution {
  const run = solveDecomposed(problem, options)

  if (run.result.solution === null) {
    return {
      audited: { result: run.result, report: null, solverContradictedByValidator: false },
      report: run.report,
    }
  }

  const report = validatePlanningSolutionV3(problem, run.result.solution)
  return {
    audited: {
      result: run.result,
      report,
      solverContradictedByValidator: !report.validHardConstraints,
    },
    report: run.report,
  }
}
