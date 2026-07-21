import type { Assignment, Shift } from "@/features/core/models"

import type { ConstraintEvaluator, ConstraintRegistry } from "@/features/core/constraint-engine"
import type { GenerationContext } from "@/features/core/planning-generator/types"
import { buildConstraintContext } from "@/features/core/planning-generator/builders"

/**
 * Decide whether placing a candidate assignment is admissible — the "filter
 * employees violating hard constraints" step, expressed purely through the
 * constraint engine.
 *
 * A candidate is rejected when, after adding it, the constraint engine reports a
 * HARD violation ATTRIBUTABLE to that candidate: one targeting its assignment,
 * or one naming its employee among the affected entities. Attribution (rather
 * than a raw violation count) is essential — otherwise a shift-level coverage
 * failure being resolved could mask an availability breach the candidate
 * introduces, since both move the total count.
 *
 * The generator owns no rule here: WHICH breaches are hard, and what they
 * reference, is decided entirely by the registry's constraints. This reads
 * their structured output; it never reimplements them.
 */
export function isAdmissibleAddition(
  evaluator: ConstraintEvaluator,
  registry: ConstraintRegistry,
  context: GenerationContext,
  shifts: readonly Shift[],
  assignmentsBefore: readonly Assignment[],
  candidate: Assignment
): boolean {
  const report = evaluator.evaluate(
    registry,
    buildConstraintContext(context, shifts, [...assignmentsBefore, candidate])
  )

  return !report.hardViolations.some((violation) => {
    const targetsCandidate =
      violation.target.scope === "assignment" &&
      violation.target.assignmentId === candidate.id
    const namesEmployee =
      violation.affected?.some(
        (ref) => ref.type === "employee" && ref.id === candidate.employeeId
      ) ?? false
    return targetsCandidate || namesEmployee
  })
}
