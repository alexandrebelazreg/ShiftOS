import type { WeekDay } from "@/features/core/models"

import type { StoreConfig } from "@/features/store/schemas/store.schema"

/**
 * Le magasin ouvre-t-il ce jour-là ?
 *
 * Une seule fonction, parce que la réponse décide de choses sans rapport entre
 * elles — une colonne dans la grille des permanences, un onglet grisé dans une
 * fiche employé — et que deux lectures divergentes des mêmes horaires
 * afficheraient un dimanche à pourvoir dans un écran et pas dans l'autre.
 *
 * Sans magasin réglé, la semaine est supposée ouverte et le dimanche fermé :
 * c'est le cas ordinaire, et l'onboarding garantit qu'on ne le rencontre pas
 * une fois l'application configurée.
 */
export function storeOpensOn(store: StoreConfig | null, day: WeekDay): boolean {
  const entry = store?.openingHours.find((hours) => hours.day === day)
  if (!entry) return day !== "sunday"
  return !entry.closed
}
