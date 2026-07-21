import type { EmployeeId } from "@/features/core/models"

import type { EmployeeHistory } from "@/features/core/employee-engine/models"

/**
 * ExperienceCalculator — a normalized `[0, 1]` experience signal for one
 * employee, derived from their history. Contract only.
 */
export interface ExperienceCalculator {
  calculate(employeeId: EmployeeId, history: EmployeeHistory): number
}
