import type { EmployeeId, IsoDate } from "@/features/core/models"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningRecord } from "@/features/planning/persistence/planning-record"

/** Saved weeks are authoritative, as for closing history. Latest revision per scope. */
export function previousWorkFromRecords(
  records: readonly PlanningRecord[], start: string, minimumRestMinutes: number
): NonNullable<PlanningProblemV3["previousWork"]> {
  const latest = new Map<string, PlanningRecord>()
  for (const record of records) {
    if (record.periodEnd >= start) continue
    const key = `${record.periodStart}|${[...(record.sectorIds ?? [])].sort().join("|")}`
    const existing = latest.get(key)
    if (!existing || record.updatedAt > existing.updatedAt) latest.set(key, record)
  }
  const byEmployee = new Map<string, Map<string, number>>()
  for (const record of latest.values()) {
    const shifts = new Map(record.state.shifts.map((shift) => [shift.id, shift]))
    for (const assignment of record.state.assignments) {
      const shift = shifts.get(assignment.shiftId)
      if (!shift || shift.date >= start || shift.segments.length === 0) continue
      const end = Math.max(...shift.segments.map((segment) => {
        const [h, m] = segment.endTime.split(":").map(Number)
        return h * 60 + m
      }))
      const id = String(assignment.employeeId)
      const days = byEmployee.get(id) ?? new Map<string, number>()
      days.set(shift.date, Math.max(days.get(shift.date) ?? 0, end))
      byEmployee.set(id, days)
    }
  }
  return [...byEmployee].sort(([a], [b]) => a.localeCompare(b)).map(([employeeId, days]) => {
    const date = [...days.keys()].sort().at(-1)!
    let consecutiveDays = 0
    let cursor = date
    while (days.has(cursor)) {
      consecutiveDays++
      cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    }
    return { employeeId: employeeId as EmployeeId, date: date as IsoDate,
      endMinutes: days.get(date)!, consecutiveDays, minimumRestMinutes }
  })
}
