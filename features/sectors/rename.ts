import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * Renommer un secteur sans détacher ceux qui y travaillent.
 *
 * Les salariés sont rattachés à un secteur PAR SON NOM, pas par identifiant.
 * Renommer « Charcuterie » en « Charcuterie traiteur » ne casse donc aucune
 * référence visible : la fiche continue de porter l'ancien nom, qui ne désigne
 * plus rien. Le secteur paraît désert, la mise en route le refuse, et
 * l'historique des fermetures ne trouve plus personne à comparer — sans qu'un
 * seul message ne relie ces effets à un renommage fait la veille.
 *
 * Le gérant qui essaie de réparer aggrave le mal, et ce n'est pas sa faute :
 * le sélecteur de secteurs n'affiche que les secteurs CONFIGURÉS, donc l'ancien
 * nom y est invisible et impossible à décocher. Cliquer sur le nouveau nom
 * l'AJOUTE à côté du périmé, et la fiche se retrouve avec deux secteurs là où
 * il n'y en a qu'un.
 *
 * D'où la déduplication ci-dessous : elle n'est pas une précaution théorique,
 * elle répare exactement l'état que ce piège a produit.
 *
 * Fonction pure : elle calcule, elle n'écrit pas.
 */

export interface SectorRename {
  readonly from: string
  readonly to: string
}

/** Les renommages entre deux états d'une même liste, appariés par identifiant. */
export function detectSectorRenames(
  before: readonly { readonly id: string; readonly name: string }[],
  after: readonly { readonly id: string; readonly name: string }[]
): readonly SectorRename[] {
  const previous = new Map(before.map((sector) => [sector.id, sector.name]))
  const renames: SectorRename[] = []
  for (const sector of after) {
    const was = previous.get(sector.id)
    // Un nom vide n'est pas un renommage : c'est un secteur qu'on est en train
    // d'écrire. Le propager effacerait le rattachement de tout le monde.
    if (was === undefined || was === sector.name || !sector.name.trim() || !was.trim()) continue
    renames.push({ from: was, to: sector.name })
  }
  return renames
}

/**
 * La liste des secteurs d'un salarié, après renommages.
 *
 * L'ordre est conservé — il porte la priorité déclarée — et le résultat ne
 * contient jamais deux fois le même nom.
 */
export function sectorsAfterRenames(
  sectors: readonly string[],
  renames: readonly SectorRename[]
): readonly string[] {
  const mapping = new Map(renames.map((rename) => [rename.from, rename.to]))
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of sectors) {
    const next = mapping.get(name) ?? name
    if (seen.has(next)) continue
    seen.add(next)
    result.push(next)
  }
  return result
}

/**
 * Les salariés à réécrire, et eux seuls.
 *
 * Rendre la liste entière ferait écrire des fiches que rien ne change — autant
 * d'occasions d'échouer, et autant de dates de modification faussées.
 */
export function employeesAffectedByRenames(
  employees: readonly EmployeeRecord[],
  renames: readonly SectorRename[]
): readonly { readonly employee: EmployeeRecord; readonly sectors: readonly string[] }[] {
  if (renames.length === 0) return []
  const touched: { employee: EmployeeRecord; sectors: readonly string[] }[] = []
  for (const employee of employees) {
    const current = employee.sectors ?? []
    const next = sectorsAfterRenames(current, renames)
    if (next.length !== current.length || next.some((name, index) => name !== current[index])) {
      touched.push({ employee, sectors: next })
    }
  }
  return touched
}
