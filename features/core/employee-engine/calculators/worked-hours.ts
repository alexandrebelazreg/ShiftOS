import type {
  Assignment,
  EmployeeId,
  IsoDate,
  Minutes,
  Shift,
} from "@/features/core/models"
import { intervalMinutes, isDateInRange, isoWeekKey, monthKey } from "@/features/core/shared"

import type { Period } from "@/features/core/employee-engine/types"
import type {
  DailyWorkedHours,
  MonthlyWorkedHours,
  WeeklyWorkedHours,
  WorkedHoursCalculator,
  WorkedHoursIssue,
  WorkedHoursResult,
} from "@/features/core/employee-engine/calculators/worked-hours-calculator"

function bucketsFromDays<TKey extends string>(
  byDay: readonly DailyWorkedHours[],
  keyOf: (date: IsoDate) => TKey
): { key: TKey; minutes: Minutes }[] {
  const totals = new Map<TKey, number>()
  for (const day of byDay) {
    const key = keyOf(day.date)
    totals.set(key, (totals.get(key) ?? 0) + day.minutes)
  }
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, minutes]) => ({ key, minutes }))
}

/**
 * The production WorkedHoursCalculator.
 *
 * Sums the duration of every segment of every shift assigned to the employee
 * within the period. Split shifts contribute all their segments; an empty
 * planning yields zero. Missing shifts and non-positive/malformed segments are
 * reported as issues and skipped — never silently miscounted. Values stay in
 * exact minutes; hours are the unrounded `minutes / 60`.
 */
export const workedHoursCalculator: WorkedHoursCalculator = {
  calculate(
    employeeId: EmployeeId,
    assignments: readonly Assignment[],
    shifts: readonly Shift[],
    period: Period
  ): WorkedHoursResult {
    const shiftById = new Map<Shift["id"], Shift>(
      shifts.map((shift) => [shift.id, shift])
    )
    const issues: WorkedHoursIssue[] = []
    const minutesByDate = new Map<IsoDate, number>()

    for (const assignment of assignments) {
      if (assignment.employeeId !== employeeId) continue

      const shift = shiftById.get(assignment.shiftId)
      if (!shift) {
        issues.push({
          code: "shift_not_found",
          message: `No shift ${assignment.shiftId} for assignment ${assignment.id}.`,
          assignmentId: assignment.id,
          shiftId: assignment.shiftId,
        })
        continue
      }

      if (!isDateInRange(shift.date, period.start, period.end)) continue

      let shiftMinutes = 0
      for (const segment of shift.segments) {
        const duration = intervalMinutes(
          segment.startTime,
          segment.endTime,
          segment.endDayOffset
        )
        if (duration === null) {
          issues.push({
            code: "invalid_segment",
            message: `Invalid segment ${segment.startTime}–${segment.endTime} on shift ${shift.id}.`,
            shiftId: shift.id,
          })
          continue
        }
        shiftMinutes += duration
      }

      minutesByDate.set(
        shift.date,
        (minutesByDate.get(shift.date) ?? 0) + shiftMinutes
      )
    }

    const byDay: DailyWorkedHours[] = [...minutesByDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, minutes]) => ({ date, minutes, hours: minutes / 60 }))

    const byWeek: WeeklyWorkedHours[] = bucketsFromDays(byDay, isoWeekKey).map(
      ({ key, minutes }) => ({ isoWeek: key, minutes, hours: minutes / 60 })
    )
    const byMonth: MonthlyWorkedHours[] = bucketsFromDays(byDay, monthKey).map(
      ({ key, minutes }) => ({ month: key, minutes, hours: minutes / 60 })
    )

    const totalMinutes = byDay.reduce((sum, day) => sum + day.minutes, 0)

    return {
      employeeId,
      period,
      totalMinutes,
      totalHours: totalMinutes / 60,
      byDay,
      byWeek,
      byMonth,
      issues,
    }
  },
}
