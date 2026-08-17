import { WEEK_DAY_LABELS } from "@/features/employees/utils/employee.labels"
import type { PermanenceCalendar } from "@/features/permanence/calendar/permanence-calendar"
import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import {
  permanenceSlotKey,
  type PermanenceMonth,
  type PermanenceRole,
} from "@/features/permanence/models/permanence-month"

/**
 * La feuille de permanence telle qu'elle part au mur.
 *
 * Le même mois que la grille de saisie, mais FIGÉ : plus une seule liste
 * déroulante, des noms écrits, et les cases vides restées vides. C'est le
 * document qu'on punaise dans le bureau et qu'on emporte, et le papier ne se
 * clique pas.
 *
 * LE MOIS, ET RIEN QUE LE MOIS. Le récapitulatif ne part pas au papier : il sert
 * à ARBITRER, devant l'écran, au moment où l'on décide — pas à être consulté par
 * l'équipe devant le tableau, qui vient y chercher son nom et un horaire.
 *
 * Ce qui est ajouté par rapport à l'écran, et qui n'a de sens que sur papier :
 * le compte des cases NON POURVUES en tête de feuille. À l'écran, une case vide
 * se voit en la regardant ; sur une feuille affichée, personne ne recompte
 * cinquante cases avant de partir en week-end.
 */

export interface PermanenceSheetCell {
  /** Ce que la case porte — le rendu en tire son gris, son tiret ou son nom. */
  readonly kind: "person" | "closed" | "outside" | "empty"
  readonly text: string
}

export interface PermanenceSheetDay {
  /** « Lundi ». */
  readonly label: string
  /** « 5/01 », ou « — » hors du mois. */
  readonly dateLabel: string
  readonly holidayName: string | null
  readonly weekend: boolean
  readonly inMonth: boolean
}

export interface PermanenceSheetWeek {
  /** « S2 ». */
  readonly label: string
  readonly days: readonly PermanenceSheetDay[]
  readonly opening: readonly PermanenceSheetCell[]
  readonly closing: readonly PermanenceSheetCell[]
  /** Les noms en repos, par journée — plusieurs par case. */
  readonly rest: readonly (readonly string[])[]
  /** Les congés de la semaine, lus dans les campagnes validées. */
  readonly paidLeave: readonly string[]
  readonly onCall: string | null
}

export interface PermanenceSheetVM {
  readonly storeName: string
  /** « Janvier 2026 ». */
  readonly monthLabel: string
  readonly weeks: readonly PermanenceSheetWeek[]
  /** Combien de personnes tiennent le tour — une ligne d'en-tête, pas un tableau. */
  readonly memberCount: number
  /** Le total des fermetures du mois. */
  readonly closingCount: number
  /** Combien de cases restent à pourvoir. Zéro : la feuille est complète. */
  readonly unfilled: number
  readonly printedAtLabel: string
}

export function buildPermanenceSheet({
  calendar,
  month,
  roster,
  paidLeaveByWeek,
  storeName,
  printedAtLabel,
}: {
  readonly calendar: PermanenceCalendar
  readonly month: PermanenceMonth
  readonly roster: readonly PermanenceMember[]
  readonly paidLeaveByWeek: ReadonlyMap<string, readonly string[]>
  readonly storeName: string
  readonly printedAtLabel: string
}): PermanenceSheetVM {
  const shortNameOf = (employeeId: string): string =>
    roster.find((member) => member.employeeId === employeeId)?.shortName ?? "Hors tour"

  const cellFor = (
    day: PermanenceCalendar["weeks"][number]["days"][number],
    role: PermanenceRole
  ): PermanenceSheetCell => {
    if (!day.inMonth) return { kind: "outside", text: "—" }
    if (!day.open) return { kind: "closed", text: day.closedLabel ?? "Fermé" }
    const employeeId = month.assignments[permanenceSlotKey(day.date, role)]
    // Une case ouverte et vide reste VIDE, jamais comblée par un tiret : c'est
    // une case à pourvoir, et le tiret la ferait passer pour un choix.
    return employeeId
      ? { kind: "person", text: shortNameOf(employeeId) }
      : { kind: "empty", text: "" }
  }

  const weeks: PermanenceSheetWeek[] = calendar.weeks.map((week) => {
    const onCall = month.weeks[week.key]?.onCallEmployeeId ?? null
    return {
      label: `S${week.number}`,
      days: week.days.map((day) => ({
        label: WEEK_DAY_LABELS[day.weekDay],
        dateLabel: day.inMonth ? day.label : "—",
        holidayName: day.holidayName,
        weekend: day.weekDay === "saturday" || day.weekDay === "sunday",
        inMonth: day.inMonth,
      })),
      opening: week.days.map((day) => cellFor(day, "opening")),
      closing: week.days.map((day) => cellFor(day, "closing")),
      rest: week.days.map((day) =>
        day.inMonth ? (month.rest[day.date] ?? []).map(shortNameOf) : []
      ),
      paidLeave: (paidLeaveByWeek.get(week.key) ?? [])
        .filter((employeeId) => roster.some((member) => member.employeeId === employeeId))
        .map(shortNameOf),
      onCall: onCall === null ? null : shortNameOf(onCall),
    }
  })

  return {
    storeName,
    monthLabel: calendar.label,
    weeks,
    memberCount: roster.length,
    closingCount: filledSlots(calendar, month, "closing"),
    unfilled: unfilledSlots(calendar, month),
    printedAtLabel,
  }
}

/** Les cases de ce rôle que quelqu'un tient. */
function filledSlots(
  calendar: PermanenceCalendar,
  month: PermanenceMonth,
  role: PermanenceRole
): number {
  return calendar.openDays.filter((day) => month.assignments[permanenceSlotKey(day.date, role)])
    .length
}

/** Les cases ouvertes que personne ne tient. */
function unfilledSlots(calendar: PermanenceCalendar, month: PermanenceMonth): number {
  return calendar.openDays.reduce((count, day) => {
    const opening = month.assignments[permanenceSlotKey(day.date, "opening")] ? 0 : 1
    const closing = month.assignments[permanenceSlotKey(day.date, "closing")] ? 0 : 1
    return count + opening + closing
  }, 0)
}
