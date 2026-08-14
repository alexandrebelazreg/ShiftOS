import type { IsoDate, WeekDay } from "@/features/core/models"

/**
 * Comment un planning se dit en français.
 *
 * Ici et nulle part ailleurs : la grille à l'écran et la feuille affichée au
 * mur nomment le même jeudi, la même durée, le même 8h30. Deux tables de
 * libellés, c'est deux vérités qui divergent au premier arrondi.
 */

export const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
}

export const MONTH_LABELS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

/** "12 août" — la date écrite comme on la lit à voix haute. */
export function longDate(date: IsoDate): string {
  const [, month, day] = date.split("-")
  return `${Number(day)} ${MONTH_LABELS[Number(month) - 1]}`
}

/** "12/08" — la date compacte des en-têtes de colonne. */
export function formatDate(date: IsoDate): string {
  const [, month, day] = date.split("-")
  return `${day}/${month}`
}

export function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(Math.abs(minutes) / 60)
  const rest = Math.abs(minutes) % 60
  return `${minutes < 0 ? "-" : ""}${hours}h${rest ? String(rest).padStart(2, "0") : ""}`
}

export function signedDurationLabel(minutes: number): string {
  if (minutes === 0) return "0h"
  return `${minutes > 0 ? "+" : ""}${durationLabel(minutes)}`
}

export function weekLabel(start: IsoDate, end: IsoDate): string {
  return `Semaine du ${formatDate(start)} au ${formatDate(end)}`
}

/**
 * « Luca Martin » → « Luca MARTIN ».
 *
 * L'usage français sur un document affiché : le nom de famille en capitales,
 * parce que c'est lui qu'on cherche dans une liste et qu'un œil qui balaie un
 * mur trouve une capitale avant de lire un mot.
 *
 * Le premier mot est le prénom, tout le reste est le nom — y compris les
 * particules et les noms composés. Un nom d'un seul mot est laissé tel quel :
 * rien ne dit s'il s'agit d'un prénom ou d'un nom, et le mettre en capitales
 * aurait affirmé une chose qu'on ignore.
 */
export function nameWithUppercaseFamily(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return name.trim()
  const [first, ...family] = parts
  return `${first} ${family.join(" ").toLocaleUpperCase("fr-FR")}`
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
