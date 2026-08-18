import type { AbsenceType } from "@/features/core/models"
import type { IsoDate } from "@/features/core/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  absenceCoversDate,
  absenceOverlaps,
  absencePeriodLabel,
} from "@/features/absences/models/absence-period"
import { absenceMotiveLabel } from "@/features/absences/models/absence-motive"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"

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
      (absence) => isLeave(absence.type) && absenceCoversDate(absence, today)
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
        absenceOverlaps(absence, currentWeekStart, currentWeekEnd)
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
    typeLabel: absenceMotiveLabel(absence.type),
    // Une absence sans fin connue se lit « depuis le 3 mars » : lui inventer une
    // date de retour la ferait passer pour un dossier réglé.
    periodLabel:
      absence.end === null
        ? absencePeriodLabel(absence)
        : formatDateRange(absence.start, absence.end),
  }
}

function isLeave(type: AbsenceType): boolean {
  return type === "paid_leave" || type === "unpaid_leave"
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
