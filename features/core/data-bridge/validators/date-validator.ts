import { isValidIsoDate, isValidTimeString } from "@/features/core/shared"

import type { BridgeInput, MappingError } from "@/features/core/data-bridge/types"

/**
 * Detect INVALID DATES and times: the planning period, absence ranges and demand
 * windows must be well-formed and correctly ordered. Format and ordering only —
 * no calendar logic.
 */
export function validateDates(input: BridgeInput): MappingError[] {
  const errors: MappingError[] = []

  checkRange(errors, "scope.period", input.scope.period.start, input.scope.period.end, "scope")

  input.absences?.forEach((absence, index) => {
    checkRange(errors, `absences[${index}].range`, absence.start, absence.end, "absence", absence.id)
  })

  input.availabilityRules?.forEach((rule, index) => {
    if (rule.date != null && !isValidIsoDate(rule.date)) {
      errors.push({
        code: "invalid_date",
        path: `availabilityRules[${index}].date`,
        message: `Invalid availability date "${rule.date}"`,
        entity: "availabilityRule",
        id: rule.id,
      })
    }
    if (rule.range != null) {
      checkRange(
        errors,
        `availabilityRules[${index}].range`,
        rule.range.start,
        rule.range.end,
        "availabilityRule",
        rule.id
      )
    }
  })

  input.demand?.requirements.forEach((requirement, index) => {
    const base = `demand.requirements[${index}]`
    if (!isValidIsoDate(requirement.date)) {
      errors.push({
        code: "invalid_date",
        path: `${base}.date`,
        message: `Invalid date "${requirement.date}"`,
        entity: "demand",
        id: requirement.id,
      })
    }
    if (!isValidTimeString(requirement.start) || !isValidTimeString(requirement.end)) {
      errors.push({
        code: "invalid_date",
        path: `${base}.window`,
        message: `Invalid time window ${requirement.start}–${requirement.end}`,
        entity: "demand",
        id: requirement.id,
      })
    }
  })

  return errors
}

function checkRange(
  errors: MappingError[],
  path: string,
  start: string,
  end: string,
  entity: string,
  id?: string
): void {
  const startValid = isValidIsoDate(start)
  const endValid = isValidIsoDate(end)
  if (!startValid || !endValid) {
    errors.push({
      code: "invalid_date",
      path,
      message: `Invalid date range ${start}–${end}`,
      entity,
      id,
    })
    return
  }
  if (end < start) {
    errors.push({
      code: "invalid_date",
      path,
      message: `Range end ${end} is before start ${start}`,
      entity,
      id,
    })
  }
}
