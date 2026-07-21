import type { ShiftId } from "@/features/core/models"
import type {
  ConstraintContext,
  ConstraintResult,
  ConstraintViolation,
} from "@/features/core/constraint-engine/models"

import { defineConstraint } from "@/features/core/constraint-catalog/utils"

const ID = "coverage.shift_coverage"

/** Configuration accepted by the coverage constraint. */
export interface CoverageConstraintConfig {
  /** Minimum assignments each shift must have. Defaults to 1. */
  readonly minAssignmentsPerShift?: number
}

/**
 * CoverageConstraint (HARD) — every shift in the planning must have at least
 * `minAssignmentsPerShift` employees assigned.
 *
 * No coverage/demand calculator exists yet (no Demand model), so this checks
 * assignment counts against a configured minimum directly.
 */
export const coverageConstraintDefinition = defineConstraint({
  id: ID,
  name: "Shift coverage",
  category: "coverage",
  description:
    "Every shift must have at least the configured minimum number of assigned employees.",
  priority: "critical",
  type: "hard",
  enabledByDefault: true,
  configurable: true,
  parameters: [
    {
      key: "minAssignmentsPerShift",
      label: "Minimum employees per shift",
      type: "number",
      required: false,
      defaultValue: 1,
      min: 0,
    },
  ],
  tags: ["coverage", "staffing"],
  version: "1.0.0",
  evaluate(config) {
    const min =
      typeof config.minAssignmentsPerShift === "number"
        ? config.minAssignmentsPerShift
        : 1

    return (context: ConstraintContext): ConstraintResult => {
      const countByShift = new Map<ShiftId, number>()
      for (const assignment of context.assignments) {
        if (assignment.planningId !== context.planning.id) continue
        countByShift.set(
          assignment.shiftId,
          (countByShift.get(assignment.shiftId) ?? 0) + 1
        )
      }

      const violations: ConstraintViolation[] = []
      for (const shift of context.shifts) {
        const count = countByShift.get(shift.id) ?? 0
        if (count < min) {
          violations.push({
            constraintId: ID,
            severity: "blocking",
            message: `Shift ${shift.id} on ${shift.date} has ${count}/${min} required assignment(s).`,
            target: { scope: "shift", shiftId: shift.id },
            affected: [{ type: "shift", id: shift.id }],
            metadata: { required: min, actual: count, date: shift.date },
          })
        }
      }

      return {
        constraintId: ID,
        outcome: violations.length > 0 ? "fail" : "pass",
        violations,
        message:
          violations.length > 0
            ? `${violations.length} shift(s) under-covered.`
            : "All shifts covered.",
      }
    }
  },
})
