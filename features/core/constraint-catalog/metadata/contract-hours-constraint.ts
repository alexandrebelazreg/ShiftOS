import { workedHoursCalculator } from "@/features/core/employee-engine/calculators/worked-hours"
import { contractualMinutes } from "@/features/core/models"
import type {
  ConstraintContext,
  ConstraintResult,
  ConstraintViolation,
} from "@/features/core/constraint-engine/models"

import { defineConstraint } from "@/features/core/constraint-catalog/utils"

const ID = "workload.contract_hours"

/** Configuration accepted by the contract-hours constraint. */
export interface ContractHoursConstraintConfig {
  /** Minutes an employee may exceed their weekly contract before warning. Default 0. */
  readonly toleranceMinutes?: number
}

/**
 * ContractHoursConstraint (SOFT) — no employee should work more than their
 * weekly contracted hours (within an optional tolerance) in any ISO week.
 * Reuses `workedHoursCalculator` (no duplicated worked-time logic).
 */
export const contractHoursConstraintDefinition = defineConstraint({
  id: ID,
  name: "Contract hours",
  category: "workload",
  description:
    "An employee should not exceed their weekly contracted hours in any week.",
  priority: "medium",
  type: "soft",
  enabledByDefault: true,
  configurable: true,
  parameters: [
    {
      key: "toleranceMinutes",
      label: "Weekly tolerance (minutes)",
      type: "number",
      required: false,
      defaultValue: 0,
      min: 0,
    },
  ],
  tags: ["workload", "working-time"],
  version: "1.0.0",
  evaluate(config) {
    const tolerance =
      typeof config.toleranceMinutes === "number" ? config.toleranceMinutes : 0

    return (context: ConstraintContext): ConstraintResult => {
      const planningAssignments = context.assignments.filter(
        (a) => a.planningId === context.planning.id
      )
      const contractByEmployee = new Map(
        context.contracts.map((c) => [c.employeeId, c])
      )

      const violations: ConstraintViolation[] = []
      for (const employee of context.employees) {
        const contract = contractByEmployee.get(employee.id)
        if (!contract) continue

        const worked = workedHoursCalculator.calculate(
          employee.id,
          planningAssignments,
          context.shifts,
          context.period
        )
        const contractMinutes = contractualMinutes(contract), limitMinutes = contractMinutes + tolerance

        for (const week of worked.byWeek) {
          if (week.minutes > limitMinutes) {
            violations.push({
              constraintId: ID,
              severity: "minor",
              message: `Employee ${employee.id} worked ${week.minutes} min in ${week.isoWeek}, over the ${contract.weeklyHours}h weekly contract.`,
              target: { scope: "employee", employeeId: employee.id },
              affected: [{ type: "employee", id: employee.id }],
              penalty: week.minutes - limitMinutes,
              metadata: {
                isoWeek: week.isoWeek,
                workedMinutes: week.minutes,
                contractMinutes,
              },
            })
          }
        }
      }

      return {
        constraintId: ID,
        outcome: violations.length > 0 ? "warning" : "pass",
        violations,
        message:
          violations.length > 0
            ? `${violations.length} over-contract week(s).`
            : "All employees within contracted hours.",
      }
    }
  },
})
