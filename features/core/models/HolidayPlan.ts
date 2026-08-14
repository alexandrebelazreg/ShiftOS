import type { IsoDate } from "@/features/core/models/common"

/**
 * HolidayPlan — ce que le magasin a décidé pour chaque jour férié, et qui a
 * accepté d'y venir.
 *
 * Vit dans le core parce que le constructeur de problème le lit, et qu'il ne
 * doit rien savoir de l'écran qui l'a rempli. Volontairement pauvre : des
 * dates, un statut, des identifiants, des minutes.
 *
 * ABSENT, IL NE CHANGE RIEN. Un magasin qui n'a jamais ouvert l'écran des
 * fériés produit exactement le planning qu'il produisait avant : chaque lecture
 * de ce plan retombe sur le chemin précédent quand la date n'y figure pas.
 */

export type HolidayOpeningKind = "chome" | "demi-chome" | "travaille"

export interface HolidayPlanEntry {
  readonly date: IsoDate
  readonly opening: HolidayOpeningKind
  /**
   * Les salariés autorisés à être retenus ce jour-là.
   *
   * ÉLIGIBLES, pas affectés : la présence d'un identifiant ici n'impose rien,
   * elle ouvre une porte que le solveur reste libre de ne pas franchir.
   */
  readonly volunteerIds: readonly string[]
  /** Les horaires exceptionnels du magasin ce jour-là. `null` s'il est chômé. */
  readonly opensAtMinutes: number | null
  readonly closesAtMinutes: number | null
}

/**
 * Ce jour férié empêche-t-il CE salarié d'être planifié ?
 *
 * Le volontariat est la seule porte d'entrée d'un férié ouvert. Quelqu'un qui
 * n'a rien coché n'est pas « disponible mais non retenu » : il est indisponible,
 * et le moteur n'a pas à arbitrer une présence que personne n'a acceptée.
 */
export function holidayBlocksEmployee(entry: HolidayPlanEntry, employeeId: string): boolean {
  if (entry.opening === "chome") return true
  return !entry.volunteerIds.includes(employeeId)
}
