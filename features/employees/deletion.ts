import type { PlanningRecord } from "@/features/planning/persistence/planning-record"
import type { PermanenceMonth } from "@/features/permanence/models/permanence-month"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"

/**
 * Une fiche créée par erreur peut disparaître ; un salarié qui a travaillé, non.
 *
 * La règle du dépôt était « la suppression n'existe pas », et elle protégeait
 * quelque chose de réel : retirer une fiche citée par un planning de l'an
 * dernier rend ce planning illisible — un créneau resterait, sans personne au
 * bout. Mais elle condamnait aussi le gérant à garder pour toujours la fiche
 * qu'il venait de créer avec une faute de frappe.
 *
 * Ce module tranche entre les deux, et il le fait en CHERCHANT, pas en faisant
 * confiance. Deux dangers précis le justifient :
 *
 * - `absences.employee_id` porte `on delete cascade`. Supprimer un salarié en
 *   base emporterait donc ses absences SANS un mot. La base ne peut pas servir
 *   de garde-fou : elle est le danger.
 * - Les plannings et les tours de permanence rangent leurs affectations dans un
 *   blob JSON, sans clé étrangère. La base n'y verrait rien du tout, et la
 *   suppression y laisserait des références mortes.
 *
 * Aucune écriture ici : ce module rend un constat, l'appelant décide.
 */

export type EmployeeCitationFamily = "planning" | "absence" | "permanence" | "leave"

/** Un endroit où la fiche est citée, nommé assez pour être retrouvé. */
export interface EmployeeCitation {
  readonly family: EmployeeCitationFamily
  readonly label: string
}

export interface EmployeeCitationSources {
  readonly plannings: readonly PlanningRecord[]
  readonly absences: readonly { readonly employeeId: string; readonly start: string }[]
  readonly permanences: readonly PermanenceMonth[]
  readonly leaveCampaigns: readonly PaidLeaveCampaign[]
}

const FAMILY_LABELS: Record<EmployeeCitationFamily, string> = {
  planning: "Planning",
  absence: "Absence",
  permanence: "Permanence",
  leave: "Congés",
}

export function citationFamilyLabel(family: EmployeeCitationFamily): string {
  return FAMILY_LABELS[family]
}

/**
 * Tout ce qui cite ce salarié, dans les quatre familles qui le peuvent.
 *
 * L'ordre est celui du plus visible au moins visible : un planning se remarque
 * tout de suite, une campagne de congés beaucoup plus tard.
 */
export function citationsOfEmployee(
  employeeId: string,
  sources: EmployeeCitationSources
): readonly EmployeeCitation[] {
  const citations: EmployeeCitation[] = []

  for (const planning of sources.plannings) {
    // Les AFFECTATIONS, et non les salariés soumis au solveur : figurer dans
    // les données d'entrée d'un brouillon veut seulement dire qu'on aurait pu
    // être retenu. Être affecté veut dire qu'on l'a été.
    const assignments = planning.state?.assignments ?? []
    if (assignments.some((assignment) => String(assignment.employeeId) === employeeId)) {
      citations.push({
        family: "planning",
        label: `${planning.label || planning.id} — semaine du ${planning.periodStart}`,
      })
    }
  }

  for (const absence of sources.absences) {
    if (absence.employeeId === employeeId) {
      citations.push({ family: "absence", label: `Absence à partir du ${absence.start}` })
    }
  }

  for (const month of sources.permanences) {
    const cited =
      Object.values(month.assignments).some((value) => value === employeeId) ||
      Object.values(month.rest).some((day) => day.includes(employeeId)) ||
      Object.values(month.weeks).some((week) => week.onCallEmployeeId === employeeId)
    if (cited) citations.push({ family: "permanence", label: `Tour de ${month.id}` })
  }

  for (const campaign of sources.leaveCampaigns) {
    const cited =
      Object.values(campaign.requests).some((request) => request.employeeId === employeeId) ||
      Object.keys(campaign.employeeSettings).includes(employeeId) ||
      Object.keys(campaign.grants).includes(employeeId)
    if (cited) citations.push({ family: "leave", label: campaign.name || `Campagne ${campaign.year}` })
  }

  return citations
}

export interface EmployeeDeletionVerdict {
  readonly deletable: boolean
  readonly citations: readonly EmployeeCitation[]
}

/**
 * Le verdict, rendu sur ce qui a été trouvé et rien d'autre.
 *
 * `deletable` est vrai QUAND RIEN NE CITE la fiche. C'est volontairement la
 * condition la plus stricte possible : un doute doit fermer la porte, parce que
 * l'erreur dans un sens se répare d'un clic — on désactive — et que l'erreur
 * dans l'autre sens ne se répare pas du tout.
 */
export function employeeDeletionVerdict(
  employeeId: string,
  sources: EmployeeCitationSources
): EmployeeDeletionVerdict {
  const citations = citationsOfEmployee(employeeId, sources)
  return { deletable: citations.length === 0, citations }
}
