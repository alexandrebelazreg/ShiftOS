import type { EmployeeId, StoreId } from "@/features/core/models"

import type { EmployeeProfile } from "@/features/core/employee-engine/models"

/**
 * EmployeeService — read access to aggregated employee profiles.
 * Contract only; async to mirror a future data source (no implementation).
 */
export interface EmployeeService {
  getProfile(employeeId: EmployeeId): Promise<EmployeeProfile | null>
  listByStore(storeId: StoreId): Promise<readonly EmployeeProfile[]>
}
