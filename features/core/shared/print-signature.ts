/**
 * La signature d'une feuille qui part au mur.
 *
 * Devant le panneau d'affichage, la question n'est pas « quand » mais « qui » :
 * à qui demander pourquoi mon samedi a changé. La date seule ne l'a jamais dit.
 *
 * Pure, et testée à part, pour une raison précise : le repli. Un nom absent ne
 * doit produire NI « par », NI « par null », NI un espace en fin de ligne — la
 * feuille doit se lire exactement comme avant, comme si de rien n'était. C'est
 * le genre de détail qu'on n'ajoute pas au moment de composer une chaîne dans
 * un composant, et qu'on découvre imprimé sur trente exemplaires.
 */
export function signPrintedLabel(
  label: string,
  printedBy: string | null | undefined
): string {
  const name = printedBy?.trim()
  return name ? `${label} par ${name}` : label
}
