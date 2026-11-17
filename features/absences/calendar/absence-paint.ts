import type { AbsenceMonthCell } from "@/features/absences/calendar/absence-month"
import {
  SELECTABLE_ABSENCE_MOTIVES,
  type AbsenceMotiveDefinition,
} from "@/features/absences/models/absence-motive"

/**
 * La saisie rapide : choisir un motif, puis cliquer ou glisser sur la grille.
 *
 * Le formulaire reste le chemin complet — demi-journée, note, heures. Mais la
 * plupart des absences d'un mois sont des journées entières d'un motif connu
 * d'avance, et les saisir une à une par le formulaire coûtait six gestes par
 * personne pour ce que la grille dit en un.
 */

/**
 * Les motifs qu'on peut poser d'un clic.
 *
 * Sont retirés ceux que le clic ne sait pas décrire : les heures de délégation,
 * qui se comptent en heures dans la journée, et « Autre », qui n'existe qu'avec
 * sa précision écrite. Ceux-là passent par le formulaire.
 */
export const QUICK_ENTRY_MOTIVES: readonly AbsenceMotiveDefinition[] =
  SELECTABLE_ABSENCE_MOTIVES.filter(
    (motive) => motive.countedInHours !== true && motive.needsDetail !== true
  )

export interface PaintRange {
  /** Indices des cases, bornes incluses, `from <= to`. */
  readonly from: number
  readonly to: number
}

/**
 * La plage couverte en glissant de `anchor` jusqu'à `hover`, sur une ligne.
 *
 * Elle s'arrête AVANT la première case déjà occupée : glisser du lundi au
 * vendredi par-dessus un arrêt du mercredi poserait sinon deux absences le même
 * jour, et la grille n'en afficherait qu'une. Une seule absence est écrite par
 * plage — trois jours de formation sont UNE formation, pas trois, pour le
 * justificatif comme pour les compteurs.
 */
export function paintRange(
  cells: readonly AbsenceMonthCell[],
  anchor: number,
  hover: number
): PaintRange | null {
  if (cells[anchor]?.absence !== null) return null
  const step = hover >= anchor ? 1 : -1
  let reached = anchor
  for (let index = anchor + step; step > 0 ? index <= hover : index >= hover; index += step) {
    if (cells[index]?.absence !== null) break
    reached = index
  }
  return { from: Math.min(anchor, reached), to: Math.max(anchor, reached) }
}
