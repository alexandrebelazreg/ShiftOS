import type { Constraint } from "@/features/core/models"
import { timeToMinutes } from "@/features/core/shared"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { toConstraintId, toEmployeeId } from "@/features/core/data-bridge/adapters"

/**
 * Translate a flat employee record's scheduling limits into core `Constraint`
 * records: fixed days off, forbidden days, max openings/closings, and the
 * individual hour bounds. One record per limit, deterministically keyed. The
 * bridge only translates the declared limits — it never decides whether they are
 * respected.
 *
 * A bound that is absent produces NO record, which is what lets the problem
 * builder tell "this employee has no hour restriction" from "this employee may
 * not start before midnight".
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

  // La MÊME heure, avec ou sans fermeté. Le drapeau choisit le type émis
  // plutôt que d'ajouter une contrainte à côté : deux règles pour une seule
  // saisie obligeraient à décider laquelle gagne, ce que personne n'a demandé.
  const earliestStart = minutesOrNull(record.earliestStartTime)
  if (earliestStart !== null) {
    constraints.push({
      id: toConstraintId(`constraint_${record.id}_start`),
      employeeId,
      type: record.startTimeIsExact === true ? "EXACT_START" : "EARLIEST_START",
      value: earliestStart,
    })
  }
  const latestEnd = minutesOrNull(record.latestEndTime)
  if (latestEnd !== null) {
    constraints.push({
      id: toConstraintId(`constraint_${record.id}_end`),
      employeeId,
      type: record.endTimeIsExact === true ? "EXACT_END" : "LATEST_END",
      value: latestEnd,
    })
  }

  for (const day of record.openingDays ?? []) {
    constraints.push({
      id: toConstraintId(`constraint_${record.id}_opens_${day}`),
      employeeId,
      type: "MUST_OPEN",
      day,
    })
  }
  for (const day of record.closingDays ?? []) {
    constraints.push({
      id: toConstraintId(`constraint_${record.id}_closes_${day}`),
      employeeId,
      type: "MUST_CLOSE",
      day,
    })
  }

  return constraints
}

/**
 * "HH:mm" → minutes since midnight, or null when unset OR malformed.
 *
 * A malformed bound is dropped rather than translated: the employee form is the
 * only thing that writes these fields and it validates them, so anything else
 * reaching here is a corrupt record, and turning it into a constraint would let
 * a bad string silently narrow someone's day.
 */
function minutesOrNull(value: string | null | undefined): number | null {
  if (typeof value !== "string" || value.trim() === "") return null
  return timeToMinutes(value.trim())
}
