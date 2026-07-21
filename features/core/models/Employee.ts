import type { CapabilityKey } from "@/features/core/models/Capability"
import type {
  ContractId,
  EmployeeId,
  StoreId,
  Timestamps,
} from "@/features/core/models/common"

/**
 * Employment status. Employees are disabled (`inactive`), never deleted, so
 * historical plannings/assignments stay intact.
 */
export const EMPLOYEE_STATUSES = ["active", "inactive"] as const
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number]

/**
 * Employee — a person scheduled at a store.
 *
 * Relationships:
 * - belongs to one Store (`storeId`).
 * - has one Contract (`contractId`; the Contract also back-references the
 *   employee).
 * - has many Constraints and Preferences (see their `employeeId`).
 * - has many Capabilities, granted by key via `capabilities` (open set — new
 *   capabilities require no change to this model).
 */
export interface Employee extends Timestamps {
  id: EmployeeId
  storeId: StoreId
  /** One-to-one contract; null until a contract is defined. */
  contractId: ContractId | null

  firstName: string
  lastName: string
  phone: string
  email: string
  status: EmployeeStatus

  /** Granted capability keys (e.g. "CAN_OPEN"). */
  capabilities: CapabilityKey[]
}
