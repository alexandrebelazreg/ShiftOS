import type { CapabilityKey } from "@/features/core/models"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * Translate an employee record's capability FLAGS into core `CapabilityKey`s.
 * A pure boolean → key mapping; it invents nothing and decides nothing.
 */
export function toCapabilityKeys(record: EmployeeRecord): CapabilityKey[] {
  const keys: CapabilityKey[] = []
  if (record.canOpen) keys.push("CAN_OPEN")
  if (record.canClose) keys.push("CAN_CLOSE")
  if (record.splitShiftAllowed) keys.push("CAN_SPLIT_SHIFT")
  return keys
}
