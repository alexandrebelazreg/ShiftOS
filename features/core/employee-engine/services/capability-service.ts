import type { CapabilityKey, EmployeeId } from "@/features/core/models"

/**
 * CapabilityService — read access to an employee's granted capabilities.
 * Contract only (no implementation).
 */
export interface CapabilityService {
  getCapabilities(employeeId: EmployeeId): Promise<readonly CapabilityKey[]>
  hasCapability(
    employeeId: EmployeeId,
    capability: CapabilityKey
  ): Promise<boolean>
}
