import type { Contract, IsoDateTime } from "@/features/core/models"

import type { StoreConfiguration } from "@/features/store/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { toContractId, toEmployeeId } from "@/features/core/data-bridge/adapters"

/**
 * Translate a flat employee record into the core `Contract`. Weekly hours and
 * working days come from the record; the daily-hour bounds come from the store's
 * shift settings (minutes → hours is a unit conversion, not a rule). One
 * contract per employee, deterministically keyed.
 */
export function mapContract(
  record: EmployeeRecord,
  config: StoreConfiguration,
  now: IsoDateTime
): Contract {
  return {
    id: toContractId(record.id),
    employeeId: toEmployeeId(record.id),
    contractType: record.contractType,
    weeklyHours: record.weeklyHours,
    workingDays: [...record.workingDays],
    minDailyHours: config.shift.minDailyDuration / 60,
    maxDailyHours: config.shift.maxDailyDuration / 60,
    createdAt: now,
    updatedAt: now,
  }
}
