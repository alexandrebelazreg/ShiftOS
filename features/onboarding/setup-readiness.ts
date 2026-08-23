import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { validateSectorDemand, type SectorDemandConfiguration } from "@/features/sectors"

export type SetupSector = SectorDemandConfiguration

/**
 * Les étapes de la mise en route, et lesquelles barrent réellement la route.
 *
 * Elles vivent ici, à côté du verdict, parce que le verdict désigne l'étape à
 * laquelle chaque manque appartient : séparées, les deux listes divergent et le
 * fil d'avancement finit par montrer une étape que rien ne peut atteindre.
 *
 * `optional` n'est pas cosmétique. Compétences et contraintes affinent un
 * planning, elles ne le rendent pas possible ; les exiger bloquerait un magasin
 * qui n'en a pas besoin. Les annoncer obligatoires était en revanche une
 * promesse fausse — le fil affichait six étapes dont deux ne se validaient
 * jamais.
 */
export const SETUP_STEPS = [
  { label: "Magasin", href: "/configuration/magasin", optional: false },
  { label: "Secteurs", href: "/configuration/secteurs", optional: false },
  { label: "Employés", href: "/configuration/employes", optional: false },
  { label: "Compétences", href: "/configuration/employes", optional: true },
  { label: "Contraintes", href: "/configuration/employes", optional: true },
  { label: "Premier planning", href: "/planning", optional: false },
] as const

export const STEP_STORE = 1
export const STEP_SECTORS = 2
export const STEP_EMPLOYEES = 3
export const STEP_FIRST_PLANNING = SETUP_STEPS.length

/**
 * Un manque, dit assez précisément pour être corrigé.
 *
 * Le verdict rendait autrefois des phrases nues. Elles ne disaient ni la cause
 * exacte ni où aller, si bien que le tableau de bord retrouvait la destination
 * en cherchant des mots dans la prose — et qu'un gérant à huit secteurs lisait
 * huit fois la même phrase sans savoir lequel de ses réglages était en cause.
 */
export interface SetupBlocker {
  /** Ce qui manque. Une phrase, qui nomme la cause et rien d'autre. */
  readonly message: string
  /** Où le corriger. Porté par le manque, jamais redevine à la lecture. */
  readonly href: string
  /** L'étape concernée, indexée sur `SETUP_STEPS` à partir de 1. */
  readonly step: number
  /** Le détail exact quand il existe : quel champ, et pourquoi il est refusé. */
  readonly details?: readonly string[]
}

export interface SetupReadiness {
  readonly ready: boolean
  readonly blockers: readonly SetupBlocker[]
}

/** Product-level gate only; it never invokes or mutates a Core engine. */
export function evaluateSetupReadiness({
  store,
  employees,
  sectors,
}: {
  readonly store: StoreConfig | null
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SetupSector[]
}): SetupReadiness {
  const blockers: SetupBlocker[] = []
  const storeStep = { href: SETUP_STEPS[0].href, step: STEP_STORE }
  const sectorStep = { href: SETUP_STEPS[1].href, step: STEP_SECTORS }
  const employeeStep = { href: SETUP_STEPS[2].href, step: STEP_EMPLOYEES }

  if (!store) blockers.push({ message: "Configurez les informations du magasin.", ...storeStep })
  if (!store?.openingHours.some((day) => !day.closed)) {
    blockers.push({ message: "Indiquez au moins un jour et des horaires d’ouverture.", ...storeStep })
  }
  if (sectors.length === 0) blockers.push({ message: "Créez au moins un secteur.", ...sectorStep })

  // Les deux causes sont séparées parce qu'elles se corrigent à deux endroits
  // différents : une demande invalide se règle sur le secteur, un secteur
  // désert se règle sur les fiches des salariés. Les fondre en une phrase
  // envoyait le gérant chercher au mauvais endroit une fois sur deux.
  for (const sector of sectors.filter((candidate) => candidate.status === "active")) {
    const name = sector.name.trim() || "sans nom"
    const issues = validateSectorDemand(sector, store)
    if (issues.length > 0) {
      blockers.push({
        message: `La configuration de demande du secteur « ${name} » est incomplète.`,
        details: issues.map((issue) => issue.message),
        ...sectorStep,
      })
    }
    // Le rattachement se fait par NOM de secteur, et non par identifiant.
    if (!employees.some((employee) => employee.status === "active" && employee.sectors?.includes(sector.name))) {
      blockers.push({
        message: `Aucun salarié actif n’est affecté au secteur « ${name} ».`,
        ...employeeStep,
      })
    }
  }

  if (employees.filter((employee) => employee.status === "active").length === 0) {
    blockers.push({ message: "Ajoutez au moins un employé actif.", ...employeeStep })
  }

  return { ready: blockers.length === 0, blockers }
}

/**
 * L'étape à montrer comme courante : la première qui barre la route.
 *
 * Elle se déduit des manques plutôt que de compter les objets créés. L'ancien
 * calcul s'arrêtait à la quatrième dès qu'un secteur et un salarié existaient,
 * puis sautait à la dernière — la cinquième n'était donc jamais courante, et
 * la barre restait figée pendant qu'on corrigeait ce qui bloquait vraiment.
 */
export function currentSetupStep(readiness: SetupReadiness): number {
  if (readiness.ready) return STEP_FIRST_PLANNING
  return Math.min(...readiness.blockers.map((blocker) => blocker.step))
}
