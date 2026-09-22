import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { PaidLeaveCampaignWeek } from "@/features/paid-leave/calendar/campaign-weeks"
import type { PaidLeaveWeekId } from "@/features/paid-leave/models/paid-leave-campaign"

/**
 * Les semaines où quelqu'un est DÉJÀ absent pour une autre raison.
 *
 * Rien ne croisait les deux écrans. Le solveur pouvait donc accorder une semaine
 * de congés payés à quelqu'un en arrêt maladie, en congé parental ou en
 * formation : deux absences superposées sur la même semaine, l'une décomptée du
 * solde de congés et l'autre pas, et personne pour s'en apercevoir avant la paie.
 *
 * DEUX SOURCES SONT ÉCARTÉES, et pour des raisons différentes.
 *
 * `paid_leave_campaign` est la campagne elle-même, relue depuis ses propres
 * attributions validées. La retenir interdirait de recalculer une campagne
 * validée : chaque semaine déjà accordée bloquerait sa propre réattribution, et
 * la seconde exécution rendrait une feuille vide.
 *
 * `holiday` est un jour férié, c'est-à-dire UN jour. Bloquer la semaine entière
 * du 15 août parce que le 15 août est férié retirerait à tout le monde la
 * semaine la plus demandée de l'année.
 *
 * Restent les absences SAISIES À LA MAIN, qui sont exactement celles qui
 * empêchent de partir.
 */
export function absentWeeksByEmployee(
  absences: readonly AbsenceRecord[],
  weeks: readonly PaidLeaveCampaignWeek[]
): ReadonlyMap<string, ReadonlySet<PaidLeaveWeekId>> {
  const blocked = new Map<string, Set<PaidLeaveWeekId>>()

  for (const absence of absences) {
    // `status` absent vaut « active » : les enregistrements antérieurs à
    // l'annulation n'en portent pas, et les lire comme annulés rouvrirait des
    // semaines que quelqu'un passe à l'hôpital.
    if (absence.status === "cancelled") continue
    if (absence.source !== undefined) continue

    for (const week of weeks) {
      // Chevauchement, et non inclusion : un arrêt du mercredi au vendredi ne
      // couvre pas la semaine mais interdit d'y poser des congés. Les dates sont
      // en ISO, donc la comparaison de chaînes suffit et ne connaît ni fuseau ni
      // heure d'été.
      if (absence.start > week.end || absence.end < week.start) continue
      const current = blocked.get(absence.employeeId) ?? new Set<PaidLeaveWeekId>()
      current.add(week.id)
      blocked.set(absence.employeeId, current)
    }
  }

  return blocked
}
