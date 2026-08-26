/**
 * Ce que l'écran de planning doit ouvrir — décidé hors de React.
 *
 * Deux questions y répondaient chacune de son côté, et c'est leur articulation
 * qui manquait :
 *
 *   • L'ADRESSE. Le tableau de bord ouvre un planning précis (`?planningId=`).
 *   • L'AFFICHAGE. La semaine et les rayons à l'écran ont peut-être, eux aussi,
 *     un planning enregistré.
 *
 * L'adresse l'emportait TANT QUE LA PAGE VIVAIT : arrivé du tableau de bord sur
 * la zone marché de la S37, choisir le Drive puis revenir à la S36 n'ouvrait
 * plus rien, alors que cette semaine-là était enregistrée — et l'écran restait
 * muet. L'adresse ne vaut donc que pour la PREMIÈRE ouverture ; ensuite c'est
 * l'affichage qui décide, et lui seul.
 */

/** Le minimum qu'un enregistrement doit dire pour qu'on sache s'il est celui-là. */
export interface DisplayablePlanning {
  readonly id: string
  readonly periodStart: string
  /** Les rayons couverts. Absents sur les enregistrements d'avant ce champ. */
  readonly sectorIds?: readonly string[]
  readonly updatedAt: string
}

/**
 * L'identifiant que l'adresse demande encore d'ouvrir, ou `null`.
 *
 * `alreadyOpened` est ce que cette page a déjà honoré — ouvert, ou cherché en
 * vain. Une fois l'adresse servie, elle n'a plus rien à dire : c'est ce qui
 * rend la main à l'affichage au lieu de le bâillonner pour toute la visite.
 */
export function planningIdToOpen(
  urlPlanningId: string | undefined,
  alreadyOpened: string | null
): string | null {
  if (!urlPlanningId) return null
  return urlPlanningId === alreadyOpened ? null : urlPlanningId
}

/**
 * Le planning enregistré pour CETTE semaine et CES rayons, ou `null`.
 *
 * Les rayons doivent correspondre exactement : un planning du Drive n'est pas
 * celui de la zone marché, et l'afficher sous l'autre étiquette serait un
 * mensonge. À égalité, le plus récemment enregistré gagne — c'est le dernier
 * état du travail, celui qu'on s'attend à retrouver en revenant.
 */
export function savedPlanningFor<T extends DisplayablePlanning>(
  records: readonly T[],
  week: string,
  sectorIds: readonly string[]
): T | null {
  const wanted = sectorKey(sectorIds)
  return (
    records
      .filter((record) => record.periodStart === week)
      .filter((record) => sectorKey(record.sectorIds ?? []) === wanted)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  )
}

/** Une sélection de rayons réduite à une clé comparable, l'ordre en moins. */
function sectorKey(sectorIds: readonly string[]): string {
  return [...sectorIds].sort().join("|")
}
