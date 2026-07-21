import type { BridgeInput, MappingError } from "@/features/core/data-bridge/types"

/**
 * Detect INVALID REFERENCES: absences and availability rules that point at an
 * employee not present in the payload. A pure lookup against the employee id
 * set — no logic beyond membership.
 */
export function validateReferences(input: BridgeInput): MappingError[] {
  const errors: MappingError[] = []
  const employeeIds = new Set(input.employees.map((e) => e.id))

  input.absences?.forEach((absence, index) => {
    if (!employeeIds.has(absence.employeeId)) {
      errors.push({
        code: "invalid_reference",
        path: `absences[${index}].employeeId`,
        message: `Absence references unknown employee "${absence.employeeId}"`,
        entity: "absence",
        id: absence.id,
      })
    }
  })

  input.availabilityRules?.forEach((rule, index) => {
    if (!employeeIds.has(rule.employeeId)) {
      errors.push({
        code: "invalid_reference",
        path: `availabilityRules[${index}].employeeId`,
        message: `Availability rule references unknown employee "${rule.employeeId}"`,
        entity: "availabilityRule",
        id: rule.id,
      })
    }
  })

  return errors
}
