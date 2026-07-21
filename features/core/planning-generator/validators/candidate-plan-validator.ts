import type { Assignment, Employee, EmployeeId, Shift } from "@/features/core/models"
import { intervalMinutes, timeToMinutes, weekDayOf } from "@/features/core/shared"
import type { CoverageRequirement } from "@/features/core/demand-engine"
import { assignmentIdFor } from "@/features/core/planning-generator/builders"
import type { GenerationContext, SectorPlanningRules } from "@/features/core/planning-generator/types"

export interface CandidatePlanViolation {
  readonly code: string
  readonly employeeId?: EmployeeId
  readonly shiftId?: string
  readonly message: string
}

/** Pure, phase-independent validation of every blocking scheduling invariant. */
export function validateCandidatePlan(
  context: GenerationContext,
  requirements: readonly CoverageRequirement[],
  shifts: readonly Shift[],
  assignments: readonly Assignment[]
): readonly CandidatePlanViolation[] {
  const violations: CandidatePlanViolation[] = []
  const shiftsById = new Map(shifts.map((shift) => [shift.id, shift]))
  const ownersByShift = new Map<string, Assignment[]>()
  for (const assignment of assignments) {
    const shift = shiftsById.get(assignment.shiftId)
    if (!shift) { violations.push(v("missing_shift", assignment.employeeId, String(assignment.shiftId), "L’affectation référence un shift absent.")); continue }
    const owners = ownersByShift.get(String(assignment.shiftId)) ?? []; owners.push(assignment); ownersByShift.set(String(assignment.shiftId), owners)
    if (assignment.id !== assignmentIdFor(assignment.shiftId, assignment.employeeId)) violations.push(v("assignment_id_incoherent", assignment.employeeId, String(shift.id), "L’identifiant de l’affectation ne correspond pas au salarié et au shift."))
  }
  for (const [shiftId, owners] of ownersByShift) if (new Set(owners.map((item) => item.employeeId)).size > 1) violations.push(v("shared_mutable_shift", undefined, shiftId, "Un shift mutable ne peut appartenir qu’à un seul salarié."))

  for (const employee of context.employees.filter((item) => item.status === "active")) validateEmployee(context, requirements, shiftsById, assignments, employee, violations)
  return violations
}

function validateEmployee(context: GenerationContext, requirements: readonly CoverageRequirement[], shiftsById: ReadonlyMap<string, Shift>, assignments: readonly Assignment[], employee: Employee, violations: CandidatePlanViolation[]) {
  const contract = context.contracts.find((item) => item.employeeId === employee.id)
  const entries = assignments.filter((item) => item.employeeId === employee.id).map((assignment) => ({ assignment, shift: shiftsById.get(assignment.shiftId) })).filter((item): item is { assignment: Assignment; shift: Shift } => !!item.shift).sort((a, b) => `${a.shift.date}|${a.shift.segments[0].startTime}|${a.shift.id}`.localeCompare(`${b.shift.date}|${b.shift.segments[0].startTime}|${b.shift.id}`))
  const byDate = new Map<string, typeof entries>()
  for (const entry of entries) { const day = byDate.get(entry.shift.date) ?? []; day.push(entry); byDate.set(entry.shift.date, day) }

  for (const [date, dayEntries] of byDate) {
    const day = weekDayOf(date), storeDay = context.store.openingHours.find((item) => item.day === day)
    const fixedOff = context.employeeConstraints.some((item) => item.employeeId === employee.id && (item.type === "FIXED_DAY_OFF" || item.type === "FORBIDDEN_DAY") && item.day === day)
    if (!contract?.workingDays.includes(day) || fixedOff) violations.push(v("unauthorised_work_day", employee.id, undefined, `${employee.firstName} travaille un jour non autorisé (${date}).`))
    if (context.absences.some((absence) => absence.employeeId === employee.id && date >= absence.range.start && date <= absence.range.end)) violations.push(v("absence", employee.id, undefined, `${employee.firstName} est absent le ${date}.`))
    const dailyMinutes = dayEntries.reduce((sum, item) => sum + duration(item.shift), 0)
    const dailyMaximum = Math.min(context.settings.maximumDailyMinutes ?? 600, (contract?.maxDailyHours ?? 10) * 60)
    if (dailyMinutes > dailyMaximum) violations.push(v("maximum_daily_duration", employee.id, undefined, `${employee.firstName} dépasse ${dailyMaximum} minutes le ${date}.`))
    if (dayEntries.length > 2) violations.push(v("too_many_daily_shifts", employee.id, undefined, `${employee.firstName} a plus de deux shifts le ${date}.`))
    for (const entry of dayEntries) {
      const shift = entry.shift, segment = shift.segments[0], minimum = minimumFor(context, employee.id)
      if (duration(shift) < minimum) violations.push(v("minimum_shift_duration", employee.id, String(shift.id), `Le shift dure moins de ${minimum} minutes.`))
      if (!storeDay || storeDay.closed || !storeDay.opensAt || !storeDay.closesAt || timeToMinutes(segment.startTime)! < timeToMinutes(storeDay.opensAt)! || timeToMinutes(segment.endTime)! > timeToMinutes(storeDay.closesAt)!) violations.push(v("outside_store_hours", employee.id, String(shift.id), `Le shift sort des horaires du magasin le ${date}.`))
      if (!insideSectorHours(context, requirements, employee.id, shift)) violations.push(v("outside_sector_hours", employee.id, String(shift.id), `Le shift sort des horaires du secteur le ${date}.`))
      if (isUnavailable(context, employee.id, shift)) violations.push(v("employee_unavailable", employee.id, String(shift.id), `${employee.firstName} est indisponible pendant ce shift.`))
      for (const requirement of requirements.filter((item) => covers(shift, item))) if (!(requirement.requiredCapabilities ?? []).every((key) => employee.capabilities.includes(key))) violations.push(v("missing_competency", employee.id, String(shift.id), `${employee.firstName} ne possède pas les compétences nécessaires.`))
      if (storeDay?.opensAt === segment.startTime && !employee.capabilities.includes("CAN_OPEN")) violations.push(v("opening_forbidden", employee.id, String(shift.id), `${employee.firstName} ne peut pas ouvrir.`))
      if (storeDay?.closesAt === segment.endTime && !employee.capabilities.includes("CAN_CLOSE")) violations.push(v("closing_forbidden", employee.id, String(shift.id), `${employee.firstName} ne peut pas fermer.`))
    }
    const sorted = [...dayEntries].sort((a, b) => a.shift.segments[0].startTime.localeCompare(b.shift.segments[0].startTime))
    for (let index = 0; index < sorted.length - 1; index++) if (overlaps(sorted[index].shift, sorted[index + 1].shift)) violations.push(v("overlapping_shifts", employee.id, undefined, `${employee.firstName} a des shifts qui se chevauchent le ${date}.`))
    if (sorted.length === 2) validateSplit(context, requirements, employee, sorted[0].shift, sorted[1].shift, violations)
  }

  const openings = entries.filter(({ shift }) => isOpening(context, shift)).length, closings = entries.filter(({ shift }) => isClosing(context, shift)).length
  const maxOpenings = countLimit(context, employee.id, "MAX_OPENINGS"), maxClosings = countLimit(context, employee.id, "MAX_CLOSINGS")
  if (maxOpenings != null && openings > maxOpenings) violations.push(v("maximum_openings", employee.id, undefined, `${employee.firstName} dépasse son maximum d’ouvertures (${maxOpenings}).`))
  if (maxClosings != null && closings > maxClosings) violations.push(v("maximum_closings", employee.id, undefined, `${employee.firstName} dépasse son maximum de fermetures (${maxClosings}).`))
  validateRestAndConsecutiveDays(context, employee, entries.map((item) => item.shift), violations)
}

function validateRestAndConsecutiveDays(context: GenerationContext, employee: Employee, shifts: readonly Shift[], violations: CandidatePlanViolation[]) {
  const dates = [...new Set(shifts.map((shift) => shift.date))].sort()
  const daily = dates.map((date) => { const items = shifts.filter((shift) => shift.date === date).sort((a, b) => a.segments[0].startTime.localeCompare(b.segments[0].startTime)); return { date, start: items[0].segments[0].startTime, end: items.at(-1)!.segments.at(-1)!.endTime } })
  const minimumRest = context.settings.minimumRestMinutes ?? 720
  for (let index = 0; index < daily.length - 1; index++) {
    const current = daily[index], next = daily[index + 1]
    const rest = (new Date(`${next.date}T${next.start}:00Z`).getTime() - new Date(`${current.date}T${current.end}:00Z`).getTime()) / 60000
    if (rest < minimumRest) violations.push(v("minimum_rest", employee.id, undefined, `${employee.firstName} ne dispose que de ${rest} minutes de repos.`))
  }
  let streak = 1
  for (let index = 1; index < daily.length; index++) { const days = (Date.parse(`${daily[index].date}T00:00:00Z`) - Date.parse(`${daily[index - 1].date}T00:00:00Z`)) / 86400000; streak = days === 1 ? streak + 1 : 1; if (streak > 6) violations.push(v("maximum_consecutive_days", employee.id, undefined, `${employee.firstName} travaille plus de six jours consécutifs.`)) }
}

function validateSplit(context: GenerationContext, requirements: readonly CoverageRequirement[], employee: Employee, first: Shift, second: Shift, violations: CandidatePlanViolation[]) {
  const sectors = sectorsForShift(context, requirements, second), allowed = employee.capabilities.includes("CAN_SPLIT_SHIFT") && sectors.some((sector) => sector.splitShiftAllowed)
  const gap = timeToMinutes(second.segments[0].startTime)! - timeToMinutes(first.segments[0].endTime)!, maximum = Math.max(...sectors.map((sector) => sector.maximumSplitDuration ?? -1))
  if (!allowed) violations.push(v("split_forbidden", employee.id, undefined, `La coupure de ${employee.firstName} n’est pas autorisée.`))
  else if (maximum < 0 || gap > maximum) violations.push(v("split_duration_exceeded", employee.id, undefined, `La coupure de ${employee.firstName} dépasse ${maximum} minutes.`))
}

function insideSectorHours(context: GenerationContext, _requirements: readonly CoverageRequirement[], employeeId: EmployeeId, shift: Shift) { const sectors = (context.business.sectors ?? []).filter((sector) => sector.assignedEmployeeIds.includes(employeeId) && sector.hours); if (!sectors.length) return true; return sectors.some((sector) => { const hours = sector.hours!.find((item) => item.day === weekDayOf(shift.date)); return !!hours && !hours.closed && timeToMinutes(shift.segments[0].startTime)! >= timeToMinutes(hours.opensAt)! && timeToMinutes(shift.segments.at(-1)!.endTime)! <= timeToMinutes(hours.closesAt)! }) }
function sectorsForShift(context: GenerationContext, requirements: readonly CoverageRequirement[], shift: Shift): readonly SectorPlanningRules[] { const ids = new Set(requirements.filter((item) => covers(shift, item)).map((item) => String(item.id))); return (context.business.sectors ?? []).filter((sector) => sector.requirementIds.some((id) => ids.has(id))) }
function minimumFor(context: GenerationContext, employeeId: EmployeeId) { const values = (context.business.sectors ?? []).filter((item) => item.assignedEmployeeIds.includes(employeeId)).map((item) => item.minimumShiftDuration); return Math.max(15, values.length ? Math.max(...values) : context.store.planningSettings.minShiftDuration ?? 120) }
function countLimit(context: GenerationContext, employeeId: EmployeeId, type: "MAX_OPENINGS" | "MAX_CLOSINGS") { return context.employeeConstraints.find((item) => item.employeeId === employeeId && item.type === type)?.value }
function isOpening(context: GenerationContext, shift: Shift) { const day = context.store.openingHours.find((item) => item.day === weekDayOf(shift.date)); return !!day?.opensAt && shift.segments[0].startTime === day.opensAt }
function isClosing(context: GenerationContext, shift: Shift) { const day = context.store.openingHours.find((item) => item.day === weekDayOf(shift.date)); return !!day?.closesAt && shift.segments.at(-1)!.endTime === day.closesAt }
function isUnavailable(context: GenerationContext, employeeId: EmployeeId, shift: Shift) { return context.availabilityRules.some((rule) => { if (rule.employeeId !== employeeId || rule.effect !== "unavailable") return false; const applies = rule.kind === "recurring" ? rule.weekDay === weekDayOf(shift.date) : rule.kind === "date" ? rule.date === shift.date : !!rule.range && shift.date >= rule.range.start && shift.date <= rule.range.end; if (!applies) return false; if (!rule.window) return true; return timeToMinutes(shift.segments[0].startTime)! < timeToMinutes(rule.window.end)! && timeToMinutes(rule.window.start)! < timeToMinutes(shift.segments.at(-1)!.endTime)! }) }
function covers(shift: Shift, requirement: CoverageRequirement) { return shift.date === requirement.window.date && shift.segments.some((segment) => timeToMinutes(segment.startTime)! <= timeToMinutes(requirement.window.start)! && timeToMinutes(segment.endTime)! >= timeToMinutes(requirement.window.end)!) }
function duration(shift: Shift) { return shift.segments.reduce((sum, segment) => sum + (intervalMinutes(segment.startTime, segment.endTime, segment.endDayOffset) ?? 0), 0) }
function overlaps(first: Shift, second: Shift) { return timeToMinutes(first.segments[0].startTime)! < timeToMinutes(second.segments.at(-1)!.endTime)! && timeToMinutes(second.segments[0].startTime)! < timeToMinutes(first.segments.at(-1)!.endTime)! }
function v(code: string, employeeId: EmployeeId | undefined, shiftId: string | undefined, message: string): CandidatePlanViolation { return { code, employeeId, shiftId, message } }
