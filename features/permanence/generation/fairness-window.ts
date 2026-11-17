import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import type { PermanenceLoad } from "@/features/permanence/models/permanence-load"
import type { PermanenceMonth } from "@/features/permanence/models/permanence-month"
import { buildPermanenceRecap } from "@/features/permanence/recap/permanence-recap"

/**
 * La mémoire du générateur : DEUX MOIS GLISSANTS.
 *
 * L'équité se comptait depuis le 1er janvier. Elle était juste sur l'année, mais
 * elle rattrapait les écarts : quelqu'un d'arrivé tard dans le tour des
 * samedis les prenait presque tous pendant des mois, et ceux qui avaient
 * beaucoup fermé l'été n'en faisaient plus aucun en décembre. Sur deux mois, le
 * passif ancien s'efface — on équilibre ce dont l'équipe se souvient, pas ce
 * qu'un tableau annuel retient.
 *
 * Deux mois et non un : sur un seul, le premier samedi de chaque mois
 * repartirait sans mémoire, et la même personne pourrait fermer le dernier
 * samedi d'octobre puis le premier de novembre.
 *
 * Le récapitulatif ANNUEL reste affiché tel quel : il sert à vérifier, pas à
 * décider.
 */
export const FAIRNESS_WINDOW_MONTHS = 2

/** Les mois qui précèdent celui-ci, du plus proche au plus ancien — l'année peut changer. */
export function previousMonths(
  year: number,
  month: number,
  count: number = FAIRNESS_WINDOW_MONTHS
): readonly { readonly year: number; readonly month: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const zeroBased = year * 12 + (month - 1) - (index + 1)
    return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 }
  })
}

/**
 * Ce que chacun a porté sur la fenêtre, avant le mois qu'on génère.
 *
 * Les mois SUIVANTS sont ignorés par construction : régénérer mars ne doit pas
 * dépendre de ce qu'on avait déjà posé en avril, sinon la même commande
 * rendrait deux résultats selon l'ordre dans lequel l'année a été remplie.
 */
export function historyBefore(
  sheets: readonly PermanenceMonth[],
  year: number,
  month: number,
  roster: readonly PermanenceMember[]
): Readonly<Record<string, PermanenceLoad>> {
  const window = new Set(previousMonths(year, month).map((entry) => `${entry.year}-${entry.month}`))
  const recap = buildPermanenceRecap(
    sheets.filter((sheet) => window.has(`${sheet.year}-${sheet.month}`)),
    roster
  )
  return Object.fromEntries(recap.rows.map((row) => [row.employeeId, row.load]))
}
