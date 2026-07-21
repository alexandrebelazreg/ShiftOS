import type { Employee, IsoDateTime, StoreId } from "@/features/core/models"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { toContractId, toEmployeeId } from "@/features/core/data-bridge/adapters"
import { toCapabilityKeys } from "@/features/core/data-bridge/transformers"

/**
 * Translate a flat employee record into the core `Employee`. Capability flags
 * become capability keys; the contract link is the deterministic contract id.
 * Pure shape translation.
 */
export function mapEmployee(
  record: EmployeeRecord,
  storeId: StoreId,
  now: IsoDateTime
): Employee {
  return {
    id: toEmployeeId(record.id),
    storeId,
    contractId: toContractId(record.id),
    firstName: record.firstName,
    lastName: record.lastName,
    phone: record.phone,
    email: record.email,
    status: record.status,
    capabilities: toCapabilityKeys(record),
    createdAt: now,
    updatedAt: now,
  }
}
