import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import { weekFromId } from "@/features/paid-leave/calendar/campaign-weeks"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"

/** Convert only the last validated snapshots into dashboard absence ranges. */
export function validatedPaidLeaveAbsences(
  campaigns: readonly PaidLeaveCampaign[]
): AbsenceRecord[] {
  const weeksByEmployee = new Map<string, Set<PaidLeaveWeekId>>()

  for (const campaign of campaigns) {
    const snapshot = campaign.validatedSnapshot
    if (!snapshot) continue
    for (const [employeeId, weeks] of Object.entries(snapshot.grants)) {
      const current = weeksByEmployee.get(employeeId) ?? new Set<PaidLeaveWeekId>()
      weeks.forEach((week) => current.add(week))
      weeksByEmployee.set(employeeId, current)
    }
  }

  return [...weeksByEmployee.entries()].flatMap(([employeeId, weekIds]) =>
    mergeConsecutiveWeeks(employeeId, [...weekIds].sort())
  )
}

function mergeConsecutiveWeeks(
  employeeId: string,
  weekIds: readonly PaidLeaveWeekId[]
): AbsenceRecord[] {
  const periods: Array<{ start: string; end: string; weeks: PaidLeaveWeekId[] }> = []
  for (const weekId of weekIds) {
    const week = weekFromId(weekId)
    const previous = periods.at(-1)
    if (previous && addDays(previous.end, 1) === week.start) {
      previous.end = week.end
      previous.weeks.push(weekId)
    } else {
      periods.push({ start: week.start, end: week.end, weeks: [weekId] })
    }
  }
  return periods.map((period) => ({
    id: `validated-paid-leave:${employeeId}:${period.weeks.join("+")}`,
    employeeId,
    type: "paid_leave",
    start: period.start,
    end: period.end,
    // La source est PORTÉE et non devinée à l'identifiant : c'est elle qui
    // interdit de corriger ici une décision prise dans l'écran des congés.
    source: "paid_leave_campaign",
    note: "Campagne de congés payés validée",
  }))
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
