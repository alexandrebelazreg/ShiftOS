import type { Assignment, EmployeeId, Shift, WeekDay } from "@/features/core/models"
import { intervalMinutes } from "@/features/core/shared"
import { earliestStart, isSplitShift, latestEnd } from "@/features/core/statistics-engine"

import type { PlanningFlowResult } from "@/features/planning/flow"

/** One shift line in the per-employee view. */
export interface ShiftRow {
  readonly date: string
  readonly start: string
  readonly end: string
  readonly hours: number
  readonly isSplit: boolean
  readonly segments: readonly { readonly start: string; readonly end: string }[]
}

/** One employee's row: identity, contracted days, total hours and their shifts. */
export interface EmployeePlanningRow {
  readonly employeeId: EmployeeId
  readonly name: string
  readonly workingDays: readonly WeekDay[]
  readonly totalHours: number
  readonly shifts: readonly ShiftRow[]
}

/**
 * Build the display rows from a successful flow result, grouped by employee.
 * Pure presentation shaping — it reuses the statistics engine utilities
 * (`earliestStart` / `latestEnd` / `isSplitShift`) and shared `intervalMinutes`
 * rather than recomputing anything.
 */
export function toEmployeePlanningRows(
  result: Extract<PlanningFlowResult, { status: "success" }>
): EmployeePlanningRow[] {
  const { coreInput, generation, statistics } = result

  const shiftById = new Map<Shift["id"], Shift>(generation.shifts.map((s) => [s.id, s]))
  const statsByEmployee = new Map(statistics.employees.map((s) => [s.employeeId, s]))
  const workingDaysByEmployee = new Map(
    coreInput.contracts.map((c) => [c.employeeId, c.workingDays])
  )

  const assignmentsByEmployee = new Map<EmployeeId, Assignment[]>()
  for (const assignment of generation.assignments) {
    const list = assignmentsByEmployee.get(assignment.employeeId) ?? []
    list.push(assignment)
    assignmentsByEmployee.set(assignment.employeeId, list)
  }

  return coreInput.employees.map((employee) => {
    const shifts = (assignmentsByEmployee.get(employee.id) ?? [])
      .map((assignment) => shiftById.get(assignment.shiftId))
      .filter((shift): shift is Shift => shift !== undefined)
      .map(toShiftRow)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

    return {
      employeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      workingDays: workingDaysByEmployee.get(employee.id) ?? [],
      totalHours: statsByEmployee.get(employee.id)?.workedHours ?? 0,
      shifts,
    }
  })
}

function toShiftRow(shift: Shift): ShiftRow {
  const minutes = shift.segments.reduce(
    (sum, segment) => sum + (intervalMinutes(segment.startTime, segment.endTime, segment.endDayOffset) ?? 0),
    0
  )
  return {
    date: shift.date,
    start: earliestStart(shift),
    end: latestEnd(shift),
    hours: minutes / 60,
    isSplit: isSplitShift(shift),
    segments: shift.segments.map((s) => ({ start: s.startTime, end: s.endTime })),
  }
}
