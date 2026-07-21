import type { Assignment, Employee, Shift } from "@/features/core/models"
import { isDateInRange, weekDayOf } from "@/features/core/shared"

import { workedHoursCalculator } from "@/features/core/employee-engine"
import type { EmployeeStatistics, StatisticsInput } from "@/features/core/statistics-engine/models"
import {
  absentDatesInPeriod,
  holidayDateSet,
  isClosingShift,
  isNightShift,
  isOpeningShift,
  isSplitShift,
  round,
} from "@/features/core/statistics-engine/utils"

/**
 * EmployeeStatisticsCalculator — produces one employee's factual statistics.
 *
 * Worked time and days are DELEGATED to the employee engine's
 * `workedHoursCalculator` (reused, never reimplemented). The remaining metrics
 * are structural classifications of the employee's assigned shifts and the
 * calendar. `totalAssignments` (planning-wide, in-period) is injected so
 * `coverageContribution` needs no second pass over every employee.
 */
export interface EmployeeStatisticsCalculator {
  calculate(
    employee: Employee,
    input: StatisticsInput,
    totalAssignments: number
  ): EmployeeStatistics
}

export const employeeStatisticsCalculator: EmployeeStatisticsCalculator = {
  calculate(
    employee: Employee,
    input: StatisticsInput,
    totalAssignments: number
  ): EmployeeStatistics {
    const { assignments, shifts, store, planning, calendar } = input
    const period = { start: planning.periodStart, end: planning.periodEnd }

    const shiftById = new Map<Shift["id"], Shift>(shifts.map((shift) => [shift.id, shift]))
    const scheduleByDay = new Map(store.openingHours.map((s) => [s.day, s]))
    const holidays = holidayDateSet(calendar.holidays, store.id)

    const assignedShifts = inPeriodShifts(employee.id, assignments, shiftById, period)
    const worked = workedHoursCalculator.calculate(employee.id, assignments, shifts, period)

    const saturdayDates = new Set<string>()
    const sundayDates = new Set<string>()
    const holidayDates = new Set<string>()
    let openingCount = 0
    let closingCount = 0
    let splitShiftCount = 0
    let nightShiftCount = 0

    for (const shift of assignedShifts) {
      const weekDay = weekDayOf(shift.date)
      if (weekDay === "saturday") saturdayDates.add(shift.date)
      if (weekDay === "sunday") sundayDates.add(shift.date)
      if (holidays.has(shift.date)) holidayDates.add(shift.date)

      if (isSplitShift(shift)) splitShiftCount += 1
      if (isNightShift(shift)) nightShiftCount += 1

      const schedule = scheduleByDay.get(weekDay)
      if (isOpeningShift(shift, schedule)) openingCount += 1
      if (isClosingShift(shift, schedule)) closingCount += 1
    }

    const absenceCount = absentDatesInPeriod(employee.id, calendar.absences, period).size
    const assignmentCount = assignedShifts.length

    return {
      employeeId: employee.id,
      period,
      workedMinutes: worked.totalMinutes,
      workedHours: worked.totalMinutes / 60,
      workedDays: worked.byDay.length,
      assignmentCount,
      openingCount,
      closingCount,
      splitShiftCount,
      weekendCount: saturdayDates.size + sundayDates.size,
      saturdayCount: saturdayDates.size,
      sundayCount: sundayDates.size,
      nightShiftCount,
      holidayCount: holidayDates.size,
      absenceCount,
      coverageContribution:
        totalAssignments > 0 ? round(assignmentCount / totalAssignments) : 0,
    }
  },
}

/** The employee's assigned shifts whose date falls inside the period. */
function inPeriodShifts(
  employeeId: Employee["id"],
  assignments: readonly Assignment[],
  shiftById: ReadonlyMap<Shift["id"], Shift>,
  period: { start: string; end: string }
): Shift[] {
  const result: Shift[] = []
  for (const assignment of assignments) {
    if (assignment.employeeId !== employeeId) continue
    const shift = shiftById.get(assignment.shiftId)
    if (shift && isDateInRange(shift.date, period.start, period.end)) result.push(shift)
  }
  return result
}
