import type { BridgeInput } from "@/features/core/data-bridge/types"
import type { MappingError } from "@/features/core/data-bridge/types"

/**
 * Detect MISSING or INVALID required scalar data on the store and employees.
 * Purely structural — presence and basic shape, never a scheduling judgement.
 */
export function validateStructure(input: BridgeInput): MappingError[] {
  const errors: MappingError[] = []

  if (isBlank(input.store.configuration.general.name)) {
    errors.push({
      code: "missing_required",
      path: "store.configuration.general.name",
      message: "Store name is required",
      entity: "store",
    })
  }

  input.employees.forEach((employee, index) => {
    const base = `employees[${index}]`
    if (isBlank(employee.firstName) || isBlank(employee.lastName)) {
      errors.push({
        code: "missing_required",
        path: `${base}.name`,
        message: "Employee first and last name are required",
        entity: "employee",
        id: employee.id,
      })
    }
    // Invalid contract: weekly hours must be a positive number.
    if (!Number.isFinite(employee.weeklyHours) || employee.weeklyHours <= 0) {
      errors.push({
        code: "invalid_value",
        path: `${base}.weeklyHours`,
        message: "Contract weekly hours must be a positive number",
        entity: "contract",
        id: employee.id,
      })
    }
    // Invalid contract: at least one working day.
    if (employee.workingDays.length === 0) {
      errors.push({
        code: "missing_required",
        path: `${base}.workingDays`,
        message: "Contract must define at least one working day",
        entity: "contract",
        id: employee.id,
      })
    }
  })

  return errors
}

function isBlank(value: string): boolean {
  return value.trim().length === 0
}
