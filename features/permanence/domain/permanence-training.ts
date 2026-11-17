import { absenceCoversDate, wasExtended } from "@/features/absences/models/absence-period"
import type { AbsenceDraft } from "@/features/absences/persistence/absence.repository"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { IsoDate } from "@/features/core/models"

/**
 * Les formations, vues depuis le tour de permanence.
 *
 * UNE FORMATION EST UNE ABSENCE, pas une case de la feuille. La poser depuis la
 * ligne « Formation » écrit une absence au motif « Formation », la même que
 * celle qu'on saisirait dans l'écran des absences : le planning la voit, le
 * compteur des absences la compte, le générateur de permanences l'écarte. La
 * ranger dans le mois de permanence, comme les repos, aurait fait exister une
 * formation que le planning de la semaine ignorait — et quelqu'un en stage à
 * Lyon se serait retrouvé au rayon le même jour.
 *
 * Le chemin inverse vaut aussi : une formation saisie dans l'écran des absences
 * s'affiche ici sans qu'on la recopie.
 */

/** Le motif lu et écrit par la ligne « Formation ». */
export const TRAINING_MOTIVE = "training"

export interface PermanenceTraining {
  readonly absenceId: string
  readonly employeeId: string
  /**
   * Se retire depuis la feuille.
   *
   * Seulement une formation d'UNE journée, saisie à la main et jamais
   * prolongée. Retirer d'un clic, sur le mardi, une formation de trois jours
   * annulerait aussi le lundi et le mercredi sans que personne l'ait vu : celle-
   * là se corrige dans l'écran des absences, où ses dates se lisent en entier.
   */
  readonly removable: boolean
}

/** Les formations de chaque journée demandée, une seule fois par personne. */
export function trainingByDate(
  absences: readonly AbsenceRecord[],
  dates: readonly IsoDate[]
): ReadonlyMap<IsoDate, readonly PermanenceTraining[]> {
  const trainings = absences.filter((absence) => absence.type === TRAINING_MOTIVE)
  const byDate = new Map<IsoDate, PermanenceTraining[]>()

  for (const date of dates) {
    const day: PermanenceTraining[] = []
    for (const absence of trainings) {
      // `absenceCoversDate` écarte les absences annulées : une formation retirée
      // reste barrée dans l'écran des absences, elle ne retire plus personne ici.
      if (!absenceCoversDate(absence, date)) continue
      if (day.some((entry) => entry.employeeId === absence.employeeId)) continue
      day.push({
        absenceId: absence.id,
        employeeId: absence.employeeId,
        removable:
          absence.start === absence.end && absence.source === undefined && !wasExtended(absence),
      })
    }
    if (day.length > 0) byDate.set(date, day)
  }

  return byDate
}

/** L'absence qu'écrit la ligne « Formation » : une journée entière, ce jour-là. */
export function trainingDraft(employeeId: string, date: IsoDate): AbsenceDraft {
  return { employeeId, type: TRAINING_MOTIVE, start: date, end: date }
}
