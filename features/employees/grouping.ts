import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * Les trois façons de lire une équipe.
 *
 * Ce ne sont pas trois habillages du même contenu : chacune répond à une
 * question différente. La carte répond « qui est cette personne », la liste
 * « comment se comparent-elles », le regroupement par secteur « qui peut tenir
 * ce rayon ». C'est cette dernière question qui justifie qu'un salarié
 * polyvalent apparaisse PLUSIEURS FOIS — une fois sous chaque secteur qu'il
 * couvre. L'afficher une seule fois, sous son secteur principal, répondrait à
 * la question du contrat et non à celle de la couverture.
 */

export const EMPLOYEE_DISPLAY_MODES = ["cards", "list", "sectors"] as const
export type EmployeeDisplayMode = (typeof EMPLOYEE_DISPLAY_MODES)[number]

export const EMPLOYEE_DISPLAY_MODE_LABELS: Record<EmployeeDisplayMode, string> = {
  cards: "Cartes",
  list: "Liste",
  sectors: "Par secteur",
}

export function isEmployeeDisplayMode(value: unknown): value is EmployeeDisplayMode {
  return typeof value === "string" && (EMPLOYEE_DISPLAY_MODES as readonly string[]).includes(value)
}

export interface EmployeeGroup {
  readonly key: string
  readonly label: string
  readonly employees: readonly EmployeeRecord[]
}

/** Le fourre-tout, nommé pour ce qu'il est : un manque à corriger. */
export const UNASSIGNED_GROUP_KEY = "__sans_secteur__"

/**
 * Les salariés rangés par secteur.
 *
 * `sectorOrder` donne l'ordre des secteurs configurés ; il est suivi tel quel,
 * pour que l'écran des salariés et celui des secteurs racontent la même
 * histoire. Un secteur cité par une fiche mais absent de cette liste apparaît
 * quand même, après les autres et par ordre alphabétique : le taire ferait
 * disparaître des gens de l'écran sans rien dire.
 *
 * Un secteur configuré mais vide apparaît AVEC ZÉRO salarié plutôt que d'être
 * omis — c'est précisément le manque que la mise en route reproche, et le
 * cacher ici obligerait à le découvrir ailleurs.
 */
export function groupEmployeesBySector(
  employees: readonly EmployeeRecord[],
  sectorOrder: readonly string[] = []
): readonly EmployeeGroup[] {
  const known = [...sectorOrder]
  const extras = new Set<string>()
  for (const employee of employees) {
    for (const sector of employee.sectors ?? []) {
      if (!known.includes(sector)) extras.add(sector)
    }
  }

  const ordered = [...known, ...[...extras].sort((left, right) => left.localeCompare(right, "fr"))]

  const groups: EmployeeGroup[] = ordered.map((sector) => ({
    key: sector,
    label: sector,
    employees: employees.filter((employee) => (employee.sectors ?? []).includes(sector)),
  }))

  const unassigned = employees.filter((employee) => (employee.sectors ?? []).length === 0)
  if (unassigned.length > 0) {
    groups.push({ key: UNASSIGNED_GROUP_KEY, label: "Sans secteur", employees: unassigned })
  }

  return groups
}
