/** Le minimum qu'un enregistrement doit dire pour qu'on sache s'il est périmé. */
export interface DatedPlanning {
  readonly id: string
  readonly periodStart: string
  readonly sectorIds?: readonly string[]
  readonly updatedAt: string
}

/**
 * Un seul enregistrement par périmètre : le DERNIER.
 *
 * Une semaine n'a pas un planning, elle en a autant que de rayons générés — et
 * autant de VERSIONS que de régénérations. Régénérer le Drive n'écrase pas
 * l'enregistrement précédent, il en crée un nouveau à côté.
 *
 * Réunir aveuglément tout ce qui porte le même lundi comptait donc chaque
 * vacation autant de fois qu'on avait régénéré : une semaine de 36h45 sortait
 * à 73h30 sur la feuille d'un salarié, et le total avait l'air d'un bug du
 * calcul d'heures alors que c'était la lecture qui était double.
 *
 * Le périmètre — la liste des rayons couverts — est ce qui distingue deux
 * plannings LÉGITIMEMENT simultanés d'une version périmée. Le Drive et la zone
 * marché se gardent tous les deux ; deux Drive ne gardent que le plus récent.
 *
 * Un enregistrement sans rayon nommé forme son propre périmètre, sous une clé
 * qu'aucune liste de rayons ne peut produire : on ne sait pas ce qu'il couvre,
 * donc on ne peut ni le confondre avec un autre, ni décider qu'il le remplace.
 */
export function latestPerSectorScope<T extends DatedPlanning>(
  records: readonly T[]
): readonly T[] {
  const latest = new Map<string, T>()

  for (const record of records) {
    const key = scopeKey(record)
    const known = latest.get(key)
    if (!known || known.updatedAt.localeCompare(record.updatedAt) < 0) {
      latest.set(key, record)
    }
  }

  return [...latest.values()]
}

function scopeKey(record: DatedPlanning): string {
  const sectors = record.sectorIds
  if (!sectors || sectors.length === 0) return `sans-rayon:${record.id}`
  return [...sectors].sort().join("|")
}
