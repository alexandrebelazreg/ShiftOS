import type { Assignment, Shift } from "@/features/core/models"
import { contractualMinutes } from "@/features/core/models"
import { intervalMinutes, weekDayOf } from "@/features/core/shared"

import type { EditorState } from "@/features/planning/editor/editor-state"
import type {
  BoardDay,
  BoardDiagnosticsInput,
  BoardDemandSlot,
  BoardEmployee,
  BoardSector,
  BoardShift,
  PlanningBoardInput,
} from "@/features/planning/board/model/board-input"

/**
 * Adapter: the V2 editor state → the engine-neutral board input.
 *
 * This file is the ONLY place that knows the board is currently fed by V2.
 * When V3 becomes the active engine, a sibling adapter is written against
 * `PlanningSolutionV3` and nothing else moves — not the ViewModel, not a single
 * component. That is the whole point of the indirection.
 *
 * Known limitation: a V2 `Shift` carries no sector, so with the single active
 * sector the product supports today every shift is attributed to it. Once
 * shifts become sector-aware the mapping below is the one line to change.
 */
export function adaptEditorStateToBoard(
  state: EditorState,
  sectors: readonly BoardSector[],
  diagnostics?: BoardDiagnosticsInput
): PlanningBoardInput {
  const sectorList: readonly BoardSector[] =
    sectors.length > 0 ? sectors : [{ id: "all", name: "Tous les secteurs" }]
  const defaultSectorId = sectorList[0].id

  const openingByDay = new Map(
    state.coreInput.store.openingHours.map((entry) => [entry.day, entry])
  )

  const days: BoardDay[] = datesOf(state).map((date) => {
    const weekDay = weekDayOf(date)
    const hours = openingByDay.get(weekDay)
    const closed = !hours || hours.closed || !hours.opensAt || !hours.closesAt
    return {
      date,
      weekDay,
      closed,
      opensAtMinutes: closed ? null : minutesOf(hours!.opensAt!),
      closesAtMinutes: closed ? null : minutesOf(hours!.closesAt!),
    }
  })

  const contractByEmployee = new Map(
    state.coreInput.contracts.map((contract) => [contract.employeeId, contract])
  )

  const employees: BoardEmployee[] = state.coreInput.employees.map((employee) => {
    const contract = contractByEmployee.get(employee.id)
    return {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      sectorIds: sectorList.map((sector) => sector.id),
      contractMinutes: contract ? contractualMinutes(contract) : 0,
      rules: rulesOf(state, employee.id),
    }
  })

  const shiftById = new Map<Shift["id"], Shift>(state.shifts.map((shift) => [shift.id, shift]))
  const dayByDate = new Map(days.map((day) => [day.date, day]))

  const shifts: BoardShift[] = state.assignments
    .map((assignment) => ({ assignment, shift: shiftById.get(assignment.shiftId) }))
    .filter((entry): entry is { assignment: Assignment; shift: Shift } => entry.shift !== undefined)
    .map(({ assignment, shift }) => {
      const segments = shift.segments
        .map((segment) => ({
          startMinutes: minutesOf(segment.startTime),
          endMinutes:
            minutesOf(segment.startTime) +
            (intervalMinutes(segment.startTime, segment.endTime, segment.endDayOffset) ?? 0),
        }))
        .sort((left, right) => left.startMinutes - right.startMinutes)
      const day = dayByDate.get(shift.date)
      const start = segments[0]?.startMinutes ?? 0
      const end = segments[segments.length - 1]?.endMinutes ?? 0
      return {
        id: assignment.id,
        employeeId: assignment.employeeId,
        sectorId: defaultSectorId,
        date: shift.date,
        startMinutes: start,
        endMinutes: end,
        workedMinutes: segments.reduce((sum, s) => sum + (s.endMinutes - s.startMinutes), 0),
        segments,
        opensDay: day?.opensAtMinutes === start,
        closesDay: day?.closesAtMinutes === end,
      }
    })

  const demand: BoardDemandSlot[] = state.coreInput.demand.requirements.map((requirement) => ({
    sectorId: sectorIdOf(String(requirement.id), sectorList, defaultSectorId),
    date: requirement.window.date,
    startMinutes: minutesOf(requirement.window.start),
    endMinutes:
      minutesOf(requirement.window.start) +
      (intervalMinutes(requirement.window.start, requirement.window.end, requirement.window.endDayOffset) ?? 0),
    requiredEmployees: requirement.minEmployees,
  }))

  return {
    periodStart: state.planning.periodStart,
    periodEnd: state.planning.periodEnd,
    sectors: sectorList,
    employees,
    days,
    shifts,
    demand,
    diagnostics,
  }
}

/** Demand ids are minted as `req_<sectorId>_<date>_<time>` by the flow. */
function sectorIdOf(
  requirementId: string,
  sectors: readonly BoardSector[],
  fallback: string
): string {
  const match = sectors.find((sector) => requirementId.startsWith(`req_${sector.id}_`))
  return match?.id ?? fallback
}

function datesOf(state: EditorState): string[] {
  const dates: string[] = []
  const cursor = new Date(`${state.planning.periodStart}T00:00:00.000Z`)
  const end = state.planning.periodEnd
  while (true) {
    const iso = cursor.toISOString().slice(0, 10)
    if (iso > end) break
    dates.push(iso)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function minutesOf(value: string): number {
  const [hours, minutes] = value.split(":").map(Number)
  return hours * 60 + minutes
}

/** Constraints and capabilities, worded once here so the panel just lists them. */
function rulesOf(state: EditorState, employeeId: Assignment["employeeId"]): string[] {
  const rules: string[] = []
  const employee = state.coreInput.employees.find((item) => item.id === employeeId)
  const contract = state.coreInput.contracts.find((item) => item.employeeId === employeeId)

  if (contract) {
    rules.push(`Contrat ${durationText(contractualMinutes(contract))} par semaine`)
    rules.push(`Journée de ${contract.minDailyHours} h à ${contract.maxDailyHours} h`)
    if (contract.workingDays.length > 0) {
      rules.push(`Jours contractuels : ${contract.workingDays.map(dayText).join(", ")}`)
    }
  }
  if (employee?.capabilities.includes("CAN_OPEN")) rules.push("Peut ouvrir")
  if (employee?.capabilities.includes("CAN_CLOSE")) rules.push("Peut fermer")
  if (employee?.capabilities.includes("CAN_SPLIT_SHIFT")) rules.push("Peut faire une coupure")

  for (const constraint of state.coreInput.employeeConstraints ?? []) {
    if (constraint.employeeId !== employeeId) continue
    if (constraint.type === "FIXED_DAY_OFF" && constraint.day) {
      rules.push(`Repos fixe : ${dayText(constraint.day)}`)
    }
    if (constraint.type === "FORBIDDEN_DAY" && constraint.day) {
      rules.push(`Jour interdit : ${dayText(constraint.day)}`)
    }
    if (constraint.type === "MAX_OPENINGS" && constraint.value != null) {
      rules.push(`Maximum ${constraint.value} ouverture(s) par semaine`)
    }
    if (constraint.type === "MAX_CLOSINGS" && constraint.value != null) {
      rules.push(`Maximum ${constraint.value} fermeture(s) par semaine`)
    }
  }
  return rules
}

function durationText(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`
}

const DAY_TEXT: Record<string, string> = {
  monday: "lundi",
  tuesday: "mardi",
  wednesday: "mercredi",
  thursday: "jeudi",
  friday: "vendredi",
  saturday: "samedi",
  sunday: "dimanche",
}

function dayText(day: string): string {
  return DAY_TEXT[day] ?? day
}
