import type { EmployeeId } from "@/features/core/models"

import type { EmployeeAvailability } from "@/features/core/employee-engine/models"
import type { Period } from "@/features/core/employee-engine/types"

/**
 * AvailabilityService — provides an employee's availability over a period.
 * Contract only (no implementation).
 */
export interface AvailabilityService {
  getAvailability(
    employeeId: EmployeeId,
    period: Period
  ): Promise<EmployeeAvailability>
}
