import type { IsoDate, WeekDay } from "@/features/core/models"
import type { AbsenceInput } from "@/features/core/data-bridge"
import { enumerateDates, weekDayOf } from "@/features/core/shared"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"

/**
 * Les absences saisies, telles que la génération doit les voir.
 *
 * Longtemps, aucune n'arrivait jusqu'au moteur : l'écran Planning ne lisait pas
 * le dépôt des absences, et une semaine générée avant qu'un congé soit posé se
 * régénérait avec le salarié dedans, sans que rien ne le signale.
 *
 * Ce qui est écarté, et pourquoi :
 * - une absence ANNULÉE, qui reste visible barrée mais ne retire plus personne ;
 * - une absence née d'un FÉRIÉ : le plan des fériés décide déjà, seul, qui
 *   travaille ce jour-là, et la relire ici ferait deux réponses à une question ;
 * - une DEMI-JOURNÉE ou des HEURES dans la journée : le problème ne sait dire
 *   qu'une journée entière disponible ou non, et bloquer le jour pour un
 *   rendez-vous d'une heure retirerait au planning une personne présente ;
 * - le salarié hors du périmètre généré, ou l'absence hors de la période : le
 *   pont refuserait la première, la seconde ne change rien.
 */
export function planningAbsences(
  records: readonly AbsenceRecord[],
  employeeIds: ReadonlySet<string>,
  period: { readonly start: string; readonly end: string }
): AbsenceInput[] {
  return records
    .filter((record) => record.status !== "cancelled")
    .filter((record) => record.source !== "holiday")
    .filter((record) => record.halfDay === undefined && record.hours === undefined)
    .filter((record) => employeeIds.has(record.employeeId))
    .filter((record) => record.start <= period.end && record.end >= period.start)
    .map((record) => ({
      id: record.id,
      employeeId: record.employeeId,
      type: record.type,
      start: record.start,
      end: record.end,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export interface AbsenceTargetInput {
  /** Le contrat, tel qu'il est écrit — avant les fériés. */
  readonly contractMinutes: number
  /** L'objectif après les fériés, d'où l'absence se retire. */
  readonly targetMinutes: number
  readonly workingDays: readonly WeekDay[]
  readonly fixedDaysOff: readonly WeekDay[]
  readonly period: { readonly start: string; readonly end: string }
  /** Le magasin ouvre-t-il ce jour-là. */
  readonly isOpen: (date: IsoDate) => boolean
  /** Les dates déjà réglées par le plan des fériés, déjà déduites de l'objectif. */
  readonly holidayDates: ReadonlySet<string>
  /** Les absences de CE salarié. */
  readonly absences: readonly AbsenceInput[]
}

/**
 * L'objectif de la semaine, absences déduites.
 *
 * Le moteur place le contrat à la minute près — c'est une égalité, pas une
 * cible. Un salarié absent trois jours sur cinq avec ses 35 h intactes rendait
 * donc la semaine impossible, ou tassait le contrat sur deux journées.
 *
 * La part retirée est PROPORTIONNELLE aux journées qu'il aurait pu travailler :
 * absent toute la semaine, il ne reste rien à placer ; absent un jour sur six,
 * un sixième. Une journée déjà retirée par un férié n'est pas retirée deux fois.
 * Ce que la paie fait de ces heures — maintenues, déduites — se lit dans le
 * motif ; la génération ne connaît que ce qui reste à placer en magasin.
 */
export function weeklyTargetAfterAbsences(input: AbsenceTargetInput): number {
  if (input.absences.length === 0) return input.targetMinutes

  const workable = enumerateDates(input.period.start as IsoDate, input.period.end as IsoDate).filter(
    (date) =>
      input.isOpen(date) &&
      input.workingDays.includes(weekDayOf(date)) &&
      !input.fixedDaysOff.includes(weekDayOf(date))
  )
  if (workable.length === 0) return input.targetMinutes

  const absentDays = workable.filter(
    (date) =>
      !input.holidayDates.has(date) &&
      input.absences.some((absence) => date >= absence.start && date <= absence.end)
  ).length
  if (absentDays === 0) return input.targetMinutes

  const removed = Math.round((input.contractMinutes * absentDays) / workable.length)
  return Math.max(0, input.targetMinutes - removed)
}

/**
 * Ramener un objectif sur le pas de la grille.
 *
 * Le constructeur refuse un contrat qui n'est pas un multiple du pas, à juste
 * titre : un créneau ne commence et ne finit que sur la grille. Mais un
 * cinquième de 36 h 45 vaut 441 minutes, et 2 205 − 441 = 1 764 n'est pas un
 * multiple de 15 — chaque férié refusait alors la semaine entière d'un salarié
 * à 36 h 45. On arrondit au pas le plus proche, une fois, ici.
 */
export function snapToStep(minutes: number, step: number): number {
  if (!Number.isInteger(step) || step <= 0) return minutes
  return Math.max(0, Math.round(minutes / step) * step)
}
