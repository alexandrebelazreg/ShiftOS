import type { AbsenceType, KnownAbsenceType } from "@/features/core/models"
import type { IsoDate } from "@/features/core/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"

export const ABSENCE_TYPE_LABELS = {
  paid_leave: "Congé payé",
  sick_leave: "Maladie",
  training: "Formation",
  unpaid_leave: "Congé sans solde",
  temporary_unavailability: "Indisponibilité",
  other: "Autre absence",
} satisfies Record<KnownAbsenceType, string>

export interface DashboardAbsenceItem extends AbsenceRecord {
  readonly employeeName: string
  readonly typeLabel: string
  readonly periodLabel: string
}

export interface DashboardAbsenceSummary {
  readonly currentLeave: readonly DashboardAbsenceItem[]
  readonly nextWeekLeaveDepartures: readonly DashboardAbsenceItem[]
  readonly otherCurrentWeekAbsences: readonly DashboardAbsenceItem[]
  readonly currentWeekLabel: string
  readonly nextWeekLabel: string
}

/** Build the three operational lists shown directly below the planning strip. */
export function buildDashboardAbsenceSummary(
  today: IsoDate,
  employees: readonly EmployeeRecord[],
  absences: readonly AbsenceRecord[]
): DashboardAbsenceSummary {
  const currentWeekStart = mondayOf(today)
  const currentWeekEnd = addDays(currentWeekStart, 6)
  const nextWeekStart = addDays(currentWeekStart, 7)
  const nextWeekEnd = addDays(nextWeekStart, 6)
  const employeeNames = new Map(
    employees.map((employee) => [
      employee.id,
      `${employee.firstName} ${employee.lastName}`.trim(),
    ])
  )
  const items = absences
    .map((absence) => toDashboardItem(absence, employeeNames))
    .sort(compareAbsences)

  return {
    currentLeave: items.filter(
      (absence) => isLeave(absence.type) && covers(absence, today)
    ),
    nextWeekLeaveDepartures: items.filter(
      (absence) =>
        isLeave(absence.type) &&
        absence.start >= nextWeekStart &&
        absence.start <= nextWeekEnd
    ),
    otherCurrentWeekAbsences: items.filter(
      (absence) =>
        !isLeave(absence.type) &&
        overlaps(absence, currentWeekStart, currentWeekEnd)
    ),
    currentWeekLabel: formatDateRange(currentWeekStart, currentWeekEnd),
    nextWeekLabel: formatDateRange(nextWeekStart, nextWeekEnd),
  }
}

function toDashboardItem(
  absence: AbsenceRecord,
  employeeNames: ReadonlyMap<string, string>
): DashboardAbsenceItem {
  return {
    ...absence,
    employeeName: employeeNames.get(absence.employeeId) || "Employé non renseigné",
    typeLabel: absenceTypeLabel(absence.type),
    periodLabel: formatDateRange(absence.start, absence.end),
  }
}

function absenceTypeLabel(type: AbsenceType): string {
  return ABSENCE_TYPE_LABELS[type as KnownAbsenceType] ?? "Autre absence"
}

function isLeave(type: AbsenceType): boolean {
  return type === "paid_leave" || type === "unpaid_leave"
}

function covers(absence: AbsenceRecord, date: string): boolean {
  return absence.start <= date && absence.end >= date
}

function overlaps(absence: AbsenceRecord, start: string, end: string): boolean {
  return absence.start <= end && absence.end >= start
}

function compareAbsences(left: DashboardAbsenceItem, right: DashboardAbsenceItem): number {
  return (
    left.start.localeCompare(right.start) ||
    left.employeeName.localeCompare(right.employeeName, "fr")
  )
}

function mondayOf(date: IsoDate): IsoDate {
  const parsed = parseIsoDate(date)
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday)
  return toIsoDate(parsed)
}

function addDays(date: IsoDate, days: number): IsoDate {
  const parsed = parseIsoDate(date)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return toIsoDate(parsed)
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function toIsoDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10) as IsoDate
}

export function formatDateRange(start: string, end: string): string {
  const format = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
  const startLabel = format.format(parseIsoDate(start)).replace(".", "")
  if (start === end) return startLabel
  const endLabel = format.format(parseIsoDate(end)).replace(".", "")
  return `${startLabel} – ${endLabel}`
}
