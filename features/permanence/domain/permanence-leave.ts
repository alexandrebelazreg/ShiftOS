import { absenceCoversDate } from "@/features/absences/models/absence-period"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import { enumerateDates, isoWeekKey } from "@/features/core/shared"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"

/**
 * Les congés payés, vus depuis le tour de permanence.
 *
 * Rien n'est saisi ici : la colonne « CP » de la feuille se LIT ailleurs. Elle
 * était manuelle dans le classeur parce qu'il n'y avait rien à quoi la relier ;
 * la retenir manuelle reviendrait à recopier à la main une décision déjà prise,
 * et à laisser les écrans se contredire dès la première correction.
 *
 * DEUX SOURCES, parce qu'un congé s'obtient de deux manières et que les deux
 * comptent autant :
 *
 * - une CAMPAGNE de congés validée, qui accorde des semaines entières ;
 * - une ABSENCE saisie au motif « congés payés », posée au fil de l'eau.
 *
 * N'en lire qu'une était le défaut : une semaine posée dans l'écran des
 * absences retirait bien la personne du tour — le générateur lit les absences —
 * mais laissait sa case CP vide, si bien que la feuille ne disait pas POURQUOI
 * elle n'apparaissait nulle part cette semaine-là.
 *
 * Seules les campagnes VALIDÉES comptent, comme pour le tableau de bord : une
 * campagne encore en arbitrage n'est pas une absence, c'est une hypothèse.
 *
 * Les identifiants de semaine des congés (`2026-W29`) sont ceux que produit
 * `isoWeekKey` : les deux modules parlent déjà la même langue.
 */
export function paidLeaveByWeek(
  campaigns: readonly PaidLeaveCampaign[],
  absences: readonly AbsenceRecord[] = []
): ReadonlyMap<string, readonly string[]> {
  const byWeek = new Map<string, string[]>()

  // Deux campagnes peuvent accorder la même semaine à la même personne — un
  // hiver et un été qui se chevauchent —, et une absence peut redire ce qu'une
  // campagne accordait déjà. Elle ne part pas deux fois en congés, et son nom
  // ne s'écrit qu'une fois.
  const add = (week: string, employeeId: string): void => {
    const current = byWeek.get(week)
    if (!current) byWeek.set(week, [employeeId])
    else if (!current.includes(employeeId)) current.push(employeeId)
  }

  for (const campaign of campaigns) {
    const snapshot = campaign.validatedSnapshot
    if (!snapshot) continue
    for (const [employeeId, weeks] of Object.entries(snapshot.grants)) {
      for (const week of weeks) add(week, employeeId)
    }
  }

  for (const absence of absences) {
    if (absence.type !== PAID_LEAVE_MOTIVE) continue
    // Journée par journée plutôt que de calculer des bornes de semaine : une
    // absence de trois jours à cheval sur deux semaines les remplit toutes les
    // deux, et une absence annulée n'en remplit aucune — `absenceCoversDate`
    // porte cette règle-là pour toute l'application.
    for (const date of enumerateDates(absence.start, absence.end)) {
      if (absenceCoversDate(absence, date)) add(isoWeekKey(date), absence.employeeId)
    }
  }

  return byWeek
}

/** Le motif que la colonne « CP » reconnaît. Un arrêt maladie n'est pas un congé. */
const PAID_LEAVE_MOTIVE = "paid_leave"
