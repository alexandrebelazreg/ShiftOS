import type { PlanningRecord } from "@/features/planning/persistence/planning-record"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors/sector-demand"

/**
 * Un secteur créé par erreur peut disparaître ; un secteur qui a produit des
 * plannings, non.
 *
 * Même arbitrage que pour les fiches salariés, avec un piège de plus qui lui
 * est propre : **les salariés sont rattachés à un secteur par son NOM**, pas
 * par son identifiant. Supprimer « Charcuterie » ne casse donc aucune référence
 * visible — cela vide silencieusement le rattachement de tous ceux qui y
 * travaillaient, et leur fiche continue de porter un nom qui ne désigne plus
 * rien. Rien dans le typage ne peut le signaler : c'est une chaîne.
 *
 * Un planning publié, lui, cite le secteur par identifiant dans `sectorIds`.
 * C'est aussi ce que lit l'historique des fermetures : retirer le secteur rend
 * ces semaines inattribuables, et l'équité perd sa mémoire.
 *
 * Aucune écriture ici : ce module rend un constat, l'appelant décide.
 */

export type SectorCitationFamily = "employee" | "planning" | "leave"

export interface SectorCitation {
  readonly family: SectorCitationFamily
  readonly label: string
}

export interface SectorCitationSources {
  /** Rattachés par NOM de secteur — c'est le piège de ce module. */
  readonly employees: readonly { readonly status: string; readonly sectors?: readonly string[]; readonly firstName?: string; readonly lastName?: string }[]
  readonly plannings: readonly PlanningRecord[]
  readonly leaveCampaigns: readonly PaidLeaveCampaign[]
}

const FAMILY_LABELS: Record<SectorCitationFamily, string> = {
  employee: "Salarié rattaché",
  planning: "Planning",
  leave: "Congés",
}

export function sectorCitationFamilyLabel(family: SectorCitationFamily): string {
  return FAMILY_LABELS[family]
}

export function citationsOfSector(
  sector: SectorDemandConfiguration,
  sources: SectorCitationSources
): readonly SectorCitation[] {
  const citations: SectorCitation[] = []

  // Par nom, y compris pour un salarié inactif : sa fiche existe encore, et la
  // réactiver plus tard doit la retrouver rattachée à quelque chose de réel.
  for (const employee of sources.employees) {
    if (employee.sectors?.includes(sector.name)) {
      const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim()
      citations.push({ family: "employee", label: name || "Salarié sans nom" })
    }
  }

  for (const planning of sources.plannings) {
    if ((planning.sectorIds ?? []).includes(sector.id)) {
      citations.push({
        family: "planning",
        label: `${planning.label || planning.id} — semaine du ${planning.periodStart}`,
      })
    }
  }

  for (const campaign of sources.leaveCampaigns) {
    const cited =
      Object.keys(campaign.coverage).includes(sector.id) ||
      campaign.reinforcementPools.some((pool) => pool.sectorId === sector.id) ||
      (campaign.solution?.reinforcementAllocations ?? []).some(
        (allocation) => allocation.sectorId === sector.id
      )
    if (cited) citations.push({ family: "leave", label: campaign.name || `Campagne ${campaign.year}` })
  }

  return citations
}

export interface SectorDeletionVerdict {
  readonly deletable: boolean
  readonly citations: readonly SectorCitation[]
}

export function sectorDeletionVerdict(
  sector: SectorDemandConfiguration,
  sources: SectorCitationSources
): SectorDeletionVerdict {
  const citations = citationsOfSector(sector, sources)
  return { deletable: citations.length === 0, citations }
}
