import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  CONTRACT_TYPE_LABELS,
  WEEK_DAY_SHORT_LABELS,
} from "@/features/employees/utils/employee.labels"

/** "John Doe" (falls back gracefully when a part is missing). */
export function getFullName(
  employee: Pick<EmployeeRecord, "firstName" | "lastName">
): string {
  return [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim()
}

/** Two-letter initials for avatars, e.g. "JD". */
export function getInitials(
  employee: Pick<EmployeeRecord, "firstName" | "lastName">
): string {
  const initials = `${employee.firstName.charAt(0)}${employee.lastName.charAt(0)}`
  return initials.toUpperCase() || "?"
}

/** Sort week days into calendar order (Mon → Sun). */
export function sortWeekDays(days: readonly WeekDay[]): WeekDay[] {
  return [...days].sort((a, b) => WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b))
}

/** "Mon, Tue, Wed" — empty state handled by the caller. */
export function formatWorkingDays(days: readonly WeekDay[]): string {
  return sortWeekDays(days)
    .map((day) => WEEK_DAY_SHORT_LABELS[day])
    .join(", ")
}

/** "35h · Part time" — compact contract summary for cards. */
export function formatContractMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60), remainder = minutes % 60
  return remainder ? `${hours} h ${String(remainder).padStart(2, "0")}` : `${hours} h`
}

export function formatContractSummary(
  employee: Pick<EmployeeRecord, "weeklyHours" | "weeklyMinutes" | "contractType">
): string {
  return `${formatContractMinutes(employee.weeklyMinutes ?? Math.round(employee.weeklyHours * 60))} · ${CONTRACT_TYPE_LABELS[employee.contractType]}`
}
