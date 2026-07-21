import type { Constraint } from "@/features/core/models"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { toConstraintId, toEmployeeId } from "@/features/core/data-bridge/adapters"

/**
 * Translate a flat employee record's scheduling limits into core `Constraint`
 * records: fixed days off, forbidden days, and max openings/closings. One record
 * per limit, deterministically keyed. The bridge only translates the declared
 * limits — it never decides whether they are respected.
 */
export function mapEmployeeConstraints(record: EmployeeRecord): Constraint[] {
  const employeeId = toEmployeeId(record.id)
  const constraints: Constraint[] = []

  for (const day of record.fixedDaysOff) {
    constraints.push({
      id: toConstraintId(`constraint_${record.id}_fixed_${day}`),
      employeeId,
      type: "FIXED_DAY_OFF",
      day,
    })
  }
  for (const day of record.forbiddenDays) {
    constraints.push({
      id: toConstraintId(`constraint_${record.id}_forbidden_${day}`),
      employeeId,
      type: "FORBIDDEN_DAY",
      day,
    })
  }
  if (record.maxOpenings !== null) {
    constraints.push({
      id: toConstraintId(`constraint_${record.id}_max_openings`),
      employeeId,
      type: "MAX_OPENINGS",
      value: record.maxOpenings,
    })
  }
  if (record.maxClosings !== null) {
    constraints.push({
      id: toConstraintId(`constraint_${record.id}_max_closings`),
      employeeId,
      type: "MAX_CLOSINGS",
      value: record.maxClosings,
    })
  }

  return constraints
}
