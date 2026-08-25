import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  CONTRACT_TYPE_LABELS,
  WEEK_DAY_SHORT_LABELS,
} from "@/features/employees/utils/employee.labels"

/**
 * « MARTIN Marie » — nom en capitales, prénom capitalisé, dans cet ordre.
 *
 * C'est la forme des listes de personnel : le nom d'abord parce que c'est sur
 * lui qu'on cherche et qu'on trie, en capitales parce qu'il se distingue ainsi
 * du prénom sans ponctuation ni gras. Une saisie faite au fil de la plume —
 * « marie MARTIN » — ressort dans la même forme que les autres.
 *
 * Les composés gardent leurs capitales internes : « jean-pierre » devient
 * « Jean-Pierre », pas « Jean-pierre ».
 */
export function getFullName(
  employee: Pick<EmployeeRecord, "firstName" | "lastName">
): string {
  const last = (employee.lastName ?? "").trim().toUpperCase()
  const first = capitalise((employee.firstName ?? "").trim())
  return [last, first].filter(Boolean).join(" ")
}

/** Première lettre de chaque partie en capitale, le reste en minuscules. */
function capitalise(value: string): string {
  return value
    .toLocaleLowerCase("fr")
    .replace(/(^|[\s'’-])(\p{L})/gu, (_match, before: string, letter: string) =>
      `${before}${letter.toLocaleUpperCase("fr")}`
    )
}

/**
 * L'ordre alphabétique du personnel : par NOM, puis par prénom.
 *
 * Comparaison française et insensible à la casse comme aux accents : sans cela
 * « Éric » se retrouverait après « Zoé », et une saisie en capitales avant
 * toutes les autres. Le prénom départage les homonymes, et l'identifiant
 * départage en dernier ressort pour que deux listes identiques s'affichent
 * toujours dans le même ordre.
 */
export function compareEmployeesByName(
  left: Pick<EmployeeRecord, "id" | "firstName" | "lastName">,
  right: Pick<EmployeeRecord, "id" | "firstName" | "lastName">
): number {
  const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true })
  return (
    collator.compare(left.lastName ?? "", right.lastName ?? "") ||
    collator.compare(left.firstName ?? "", right.firstName ?? "") ||
    String(left.id).localeCompare(String(right.id))
  )
}

/** La même liste, rangée par NOM Prénom. */
export function sortEmployeesByName<T extends Pick<EmployeeRecord, "id" | "firstName" | "lastName">>(
  employees: readonly T[]
): T[] {
  return [...employees].sort(compareEmployeesByName)
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
