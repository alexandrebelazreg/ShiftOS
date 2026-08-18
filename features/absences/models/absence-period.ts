import type { IsoDate } from "@/features/core/models"

import type { AbsenceRecord } from "@/features/absences/types/absence-record"

/**
 * La lecture des dates d'une absence, écrite UNE FOIS.
 *
 * Quatre écrans comparaient jusqu'ici `start` et `end` à la main, chacun
 * ignorant ce que les autres savaient. Une absence ANNULÉE, en particulier, ne
 * couvre plus rien : elle reste lisible à l'écran, barrée, mais elle ne retire
 * plus personne d'un planning ni d'un tour de permanence. Cette règle-là ne se
 * lit pas dans les dates, et trois des quatre lectures l'auraient ignorée.
 */

/** L'absence couvre-t-elle cette date ? */
export function absenceCoversDate(absence: AbsenceRecord, date: IsoDate): boolean {
  if (isCancelled(absence)) return false
  return date >= absence.start && date <= absence.end
}

/** L'absence rencontre-t-elle cette période, bornes incluses ? */
export function absenceOverlaps(
  absence: AbsenceRecord,
  start: IsoDate,
  end: IsoDate
): boolean {
  if (isCancelled(absence)) return false
  return absence.start <= end && absence.end >= start
}

/** Les absences qui retirent quelqu'un du magasin ce jour-là. */
export function absencesOnDate(
  absences: readonly AbsenceRecord[],
  date: IsoDate
): readonly AbsenceRecord[] {
  return absences.filter((absence) => absenceCoversDate(absence, date))
}

/** Les identifiants des salariés absents à cette date. */
export function absentEmployeeIds(
  absences: readonly AbsenceRecord[],
  date: IsoDate
): ReadonlySet<string> {
  return new Set(absencesOnDate(absences, date).map((absence) => absence.employeeId))
}

export function isCancelled(absence: AbsenceRecord): boolean {
  return absence.status === "cancelled"
}

/** A-t-elle déjà été prolongée ? */
export function wasExtended(absence: AbsenceRecord): boolean {
  return (absence.extensions?.length ?? 0) > 0
}

/**
 * La période telle qu'elle s'affiche. Une absence d'un seul jour ne s'écrit pas
 * « du 9 au 9 » : c'est la même journée, et la répéter la fait lire deux fois.
 */
export function absencePeriodLabel(absence: AbsenceRecord): string {
  const start = formatDay(absence.start)
  if (absence.end === absence.start) {
    return absence.halfDay === undefined
      ? `le ${start}`
      : `le ${start} (${absence.halfDay === "morning" ? "matin" : "après-midi"})`
  }
  return `du ${start} au ${formatDay(absence.end)}`
}

function formatDay(date: string): string {
  const [year, month, day] = date.split("-")
  return `${day}/${month}/${year}`
}
