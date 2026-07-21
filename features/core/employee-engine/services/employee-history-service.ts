import type { EmployeeId } from "@/features/core/models"

import type { EmployeeHistory } from "@/features/core/employee-engine/models"
import type { Period } from "@/features/core/employee-engine/types"

/**
 * EmployeeHistoryService — provides an employee's history over a period.
 * Contract only (no implementation).
 */
export interface EmployeeHistoryService {
  getHistory(employeeId: EmployeeId, period: Period): Promise<EmployeeHistory>
}
