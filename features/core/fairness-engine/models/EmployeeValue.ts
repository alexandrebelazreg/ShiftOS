import type { EmployeeId } from "@/features/core/models"

/**
 * EmployeeValue — one employee's measured value for a dimension (e.g. their
 * worked minutes, or their opening count). The raw material of a distribution,
 * kept in the report so every fairness figure can be explained.
 */
export interface EmployeeValue {
  readonly employeeId: EmployeeId
  readonly value: number
}
