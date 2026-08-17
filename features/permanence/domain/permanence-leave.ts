import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"

/**
 * Les congés payés, vus depuis le tour de permanence.
 *
 * Rien n'est saisi ici : la colonne « CP » de la feuille se LIT dans les
 * campagnes de congés. Elle était manuelle dans le classeur parce qu'il n'y
 * avait rien à quoi la relier ; la retenir manuelle maintenant reviendrait à
 * recopier à la main une décision déjà prise ailleurs, et à laisser les deux
 * écrans se contredire dès la première correction.
 *
 * Seules les campagnes VALIDÉES comptent, comme pour le tableau de bord : une
 * campagne encore en arbitrage n'est pas une absence, c'est une hypothèse, et
 * elle ne doit écarter personne du tour.
 *
 * Les identifiants de semaine des congés (`2026-W29`) sont ceux que produit
 * `isoWeekKey` : les deux modules parlent déjà la même langue, il n'y a pas de
 * conversion à faire — et c'est bien pour cela que la jonction tient.
 */
export function paidLeaveByWeek(
  campaigns: readonly PaidLeaveCampaign[]
): ReadonlyMap<string, readonly string[]> {
  const byWeek = new Map<string, string[]>()

  for (const campaign of campaigns) {
    const snapshot = campaign.validatedSnapshot
    if (!snapshot) continue
    for (const [employeeId, weeks] of Object.entries(snapshot.grants)) {
      for (const week of weeks) {
        const current = byWeek.get(week)
        // Deux campagnes peuvent accorder la même semaine à la même personne —
        // un hiver et un été qui se chevauchent d'une semaine. Elle ne part pas
        // deux fois en congés, et son nom ne s'écrit qu'une fois.
        if (!current) byWeek.set(week, [employeeId])
        else if (!current.includes(employeeId)) current.push(employeeId)
      }
    }
  }

  return byWeek
}
