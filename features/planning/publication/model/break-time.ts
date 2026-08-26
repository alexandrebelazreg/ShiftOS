/**
 * Le temps de pause qu'une vacation ouvre, tel qu'il s'écrit sur la feuille.
 *
 * TROIS MINUTES PAR HEURE TRAVAILLÉE, au prorata des minutes réelles : une
 * vacation ne dure presque jamais un nombre entier d'heures, et arrondir la
 * durée avant de calculer ferait perdre un quart d'heure de pause sur une
 * semaine. 7h45 ouvre donc 23 minutes, et non 21.
 *
 * L'arrondi ne vient qu'à la fin, à la minute la plus proche : c'est un chiffre
 * qu'on lit sur un mur, pas une paie.
 *
 * LE SUPPLÉMENT DE CAISSE N'EST PAS ICI, et c'est délibéré. La règle est
 * connue — cinq minutes de plus, UNE SEULE FOIS par vacation, quelle que soit
 * sa durée — mais aucun rayon de caisse n'existe encore dans la configuration,
 * et le reconnaître au nom serait le rendre silencieusement faux le jour d'un
 * renommage. Le jour où le rayon existe, il portera une case à cocher et cette
 * fonction prendra un second argument. Écrire la règle maintenant sans pouvoir
 * la déclencher aurait produit du code qu'aucun test ne peut atteindre.
 */
export function breakMinutes(workedMinutes: number): number {
  if (workedMinutes <= 0) return 0
  return Math.round((workedMinutes * 3) / 60)
}

/** « 23 min », ou `null` quand il n'y a pas de quoi faire une minute. */
export function breakLabel(workedMinutes: number): string | null {
  const minutes = breakMinutes(workedMinutes)
  return minutes > 0 ? `${minutes} min` : null
}

/**
 * « 7h45 (23 min) » — la durée, et entre parenthèses ce qu'elle ouvre.
 *
 * La pause voyage AVEC la durée plutôt que sur sa propre ligne : la feuille
 * doit tenir sur une page, et chaque ligne ajoutée à une case se paie sept fois
 * par salarié. Sans pause à afficher, la durée reste seule — jamais « (0 min) »,
 * qui laisserait croire à une pause supprimée plutôt qu'inexistante.
 */
export function durationWithBreak(durationLabel: string, workedMinutes: number): string {
  const pause = breakLabel(workedMinutes)
  return pause ? `${durationLabel} (${pause})` : durationLabel
}
