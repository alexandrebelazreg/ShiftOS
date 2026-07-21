import type { EmployeeId } from "@/features/core/models"
import { availabilityCalculator } from "@/features/core/employee-engine/calculators/availability"
import type { EmployeeAvailability } from "@/features/core/employee-engine/models"
import type {
  ConstraintContext,
  ConstraintResult,
  ConstraintViolation,
} from "@/features/core/constraint-engine/models"

import { defineConstraint } from "@/features/core/constraint-catalog/utils"

const ID = "availability.employee_availability"

/**
 * AvailabilityConstraint (HARD) — every assignment must put an employee on a
 * date they are available for. Reuses `availabilityCalculator` (no duplicated
 * availability logic); each employee's availability is computed once.
 */
export const availabilityConstraintDefinition = defineConstraint({
  id: ID,
  name: "Employee availability",
  category: "availability",
  description:
    "An employee may only be assigned on dates they are available.",
  priority: "critical",
  type: "hard",
  enabledByDefault: true,
  configurable: false,
  parameters: [],
  tags: ["availability"],
  version: "1.0.0",
  evaluate() {
    return (context: ConstraintContext): ConstraintResult => {
      const contractByEmployee = new Map(
        context.contracts.map((c) => [c.employeeId, c])
      )
      const shiftById = new Map(context.shifts.map((s) => [s.id, s]))
      const availabilityCache = new Map<EmployeeId, EmployeeAvailability>()

      const availabilityFor = (employeeId: EmployeeId): EmployeeAvailability => {
        const cached = availabilityCache.get(employeeId)
        if (cached) return cached
        const availability = availabilityCalculator.calculate({
          employeeId,
          period: context.period,
          store: context.store,
          contract: contractByEmployee.get(employeeId) ?? null,
          constraints: context.employeeConstraints,
          availabilityRules: context.availabilityRules,
          absences: context.absences,
          holidays: context.holidays,
        })
        availabilityCache.set(employeeId, availability)
        return availability
      }

      const violations: ConstraintViolation[] = []
      for (const assignment of context.assignments) {
        if (assignment.planningId !== context.planning.id) continue
        const shift = shiftById.get(assignment.shiftId)
        if (!shift) continue

        const availability = availabilityFor(assignment.employeeId)
        const day = availability.days.find((d) => d.date === shift.date)
        if (!day || day.status !== "available") {
          violations.push({
            constraintId: ID,
            severity: "blocking",
            message: `Employee ${assignment.employeeId} is not available on ${shift.date}${
              day?.unavailableReason ? ` (${day.unavailableReason})` : ""
            }.`,
            target: { scope: "assignment", assignmentId: assignment.id },
            affected: [
              { type: "employee", id: assignment.employeeId },
              { type: "shift", id: shift.id },
            ],
            metadata: {
              date: shift.date,
              reason: day?.unavailableReason ?? "out_of_period",
            },
          })
        }
      }

      return {
        constraintId: ID,
        outcome: violations.length > 0 ? "fail" : "pass",
        violations,
        message:
          violations.length > 0
            ? `${violations.length} assignment(s) on unavailable dates.`
            : "All assignments respect availability.",
      }
    }
  },
})
