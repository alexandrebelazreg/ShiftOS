import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  effectiveRequestedWeeks,
  grantableWishes,
  orphanedWishes,
  wishPlansDisagree,
} from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Ce qu'il faut savoir AVANT de lancer un calcul, et ce qu'il faut dire APRÈS.
 *
 * Deux fonctions pures, parce que les deux ont le même défaut à corriger : la
 * génération réussissait en silence. Elle annonçait « solution optimale » après
 * avoir n'accordé aucune semaine, et elle ne prévenait pas que certaines
 * personnes ne pesaient sur aucun minimum de couverture. Un calcul qui se
 * félicite de n'avoir rien fait est pire qu'un calcul en échec : personne ne va
 * chercher pourquoi.
 */

export interface PaidLeaveGenerationWarning {
  readonly kind: "sector" | "orphaned-wishes" | "uneven-wishes" | "no-wishes"
  readonly message: string
}

export interface PaidLeaveReportInput {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly weekIds: ReadonlySet<PaidLeaveWeekId>
}

/** Au plus ce nombre de noms dans un message ; au-delà, on compte. */
const NAMES_SHOWN = 3

/**
 * Ce qui faussera le calcul, dit avant de le lancer.
 *
 * Des avertissements et non des refus : un gérant peut vouloir une proposition
 * pendant que deux fiches restent à compléter, et un blocage se contournerait
 * en désactivant les gens. Mais il doit savoir ce qu'il regarde.
 */
export function paidLeaveGenerationWarnings(
  input: PaidLeaveReportInput
): readonly PaidLeaveGenerationWarning[] {
  const active = input.employees.filter((employee) => employee.status === "active")
  const sectorNames = new Set(
    input.sectors.filter((sector) => sector.status === "active").map((sector) => sector.name)
  )
  const warnings: PaidLeaveGenerationWarning[] = []

  // Un salarié dont le rayon principal ne correspond à aucun secteur actif part
  // au solveur avec un secteur nul, et son absence ne pèse alors sur AUCUN
  // minimum : la couverture paraît tenue là où elle ne l'est pas.
  const withoutSector = active.filter(
    (employee) => !employee.sectors?.[0] || !sectorNames.has(employee.sectors[0])
  )
  if (withoutSector.length > 0) {
    warnings.push({
      kind: "sector",
      message:
        `${listNames(withoutSector)} ${plural(withoutSector.length, "n’a", "n’ont")} pas de rayon principal reconnu : ` +
        `${plural(withoutSector.length, "son absence ne pèsera", "leurs absences ne pèseront")} sur aucun minimum de couverture.`,
    })
  }

  // Des vœux hors période survivent à un changement de période. Ils ne peuvent
  // plus être accordés, et sans cette ligne la personne paraît simplement
  // mal servie.
  const withOrphans = active.filter(
    (employee) => orphanedWishes(input.campaign.requests[employee.id], input.weekIds).length > 0
  )
  if (withOrphans.length > 0) {
    warnings.push({
      kind: "orphaned-wishes",
      message:
        `${listNames(withOrphans)} ${plural(withOrphans.length, "a", "ont")} des vœux hors de la période de la campagne : ` +
        `ces semaines ne peuvent pas être attribuées.`,
    })
  }

  // Trois plans de tailles différentes ne décrivent pas la même absence. C'est
  // le plus grand qui fait foi, donc rien n'est perdu — mais c'est presque
  // toujours une saisie inachevée, et la personne obtiendra plus ou moins que
  // ce que le gérant croit avoir demandé.
  const uneven = active.filter((employee) =>
    wishPlansDisagree(input.campaign.requests[employee.id], input.weekIds)
  )
  if (uneven.length > 0) {
    warnings.push({
      kind: "uneven-wishes",
      message:
        `${listNames(uneven)} ${plural(uneven.length, "n’a", "n’ont")} pas le même nombre de semaines ` +
        `dans chaque vœu : c’est le plus grand qui sera demandé.`,
    })
  }

  const noWishes = active.filter(
    (employee) => grantableWishes(input.campaign.requests[employee.id], input.weekIds).length === 0
  )
  if (noWishes.length > 0) {
    warnings.push({
      kind: "no-wishes",
      message:
        `${listNames(noWishes)} ${plural(noWishes.length, "n’a", "n’ont")} aucun vœu dans la période : ` +
        `${plural(noWishes.length, "aucune semaine ne peut lui être attribuée", "aucune semaine ne peut leur être attribuée")}.`,
    })
  }

  return warnings
}

export interface PaidLeaveOutcome {
  readonly grantedWeeks: number
  readonly requestedWeeks: number
  readonly incompleteEmployees: number
  /** La phrase à afficher, déjà formulée. */
  readonly message: string
}

/**
 * Ce que la génération a réellement produit.
 *
 * « Solution optimale trouvée en 1,2 s » ne dit pas si quelqu'un a obtenu quoi
 * que ce soit — et l'optimum d'un problème où personne ne demande rien est
 * l'ensemble vide. Le compte rendu porte donc les trois nombres qui décident de
 * la suite : accordé, demandé, et combien de personnes restent incomplètes.
 */
export function describePaidLeaveOutcome(
  input: PaidLeaveReportInput & { readonly durationMs: number }
): PaidLeaveOutcome {
  const active = input.employees.filter((employee) => employee.status === "active")
  let grantedWeeks = 0
  let requestedWeeks = 0
  let incompleteEmployees = 0

  for (const employee of active) {
    const granted = input.campaign.grants[employee.id]?.length ?? 0
    const requested = effectiveRequestedWeeks(input.campaign.requests[employee.id], input.weekIds)
    grantedWeeks += granted
    requestedWeeks += requested
    if (granted !== requested) incompleteEmployees += 1
  }

  const seconds = (input.durationMs / 1000).toFixed(1)
  const head =
    requestedWeeks === 0
      ? "Aucune semaine n’était demandée : le calcul n’avait rien à attribuer."
      : `${grantedWeeks} semaine${grantedWeeks > 1 ? "s" : ""} attribuée${grantedWeeks > 1 ? "s" : ""} sur ${requestedWeeks} demandée${requestedWeeks > 1 ? "s" : ""}.`
  const tail =
    incompleteEmployees > 0
      ? ` ${incompleteEmployees} personne${incompleteEmployees > 1 ? "s" : ""} reste${incompleteEmployees > 1 ? "nt" : ""} incomplète${incompleteEmployees > 1 ? "s" : ""}.`
      : requestedWeeks > 0
        ? " Toutes les demandes sont servies."
        : ""

  return {
    grantedWeeks,
    requestedWeeks,
    incompleteEmployees,
    message: `${head}${tail} Optimum prouvé en ${seconds} s.`,
  }
}

function listNames(employees: readonly EmployeeRecord[]): string {
  const names = employees.map((employee) => `${employee.firstName} ${employee.lastName}`.trim())
  if (names.length <= NAMES_SHOWN) return names.join(", ")
  return `${names.slice(0, NAMES_SHOWN).join(", ")} et ${names.length - NAMES_SHOWN} autre${
    names.length - NAMES_SHOWN > 1 ? "s" : ""
  }`
}

function plural(count: number, one: string, many: string): string {
  return count > 1 ? many : one
}
