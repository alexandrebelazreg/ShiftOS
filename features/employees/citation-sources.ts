"use client"

import { absenceService } from "@/features/absences/services/absence.service"
import { paidLeaveStore } from "@/features/paid-leave/persistence/paid-leave.store"
import { permanenceStore } from "@/features/permanence/persistence/permanence.store"
import { planningStore } from "@/features/planning/persistence/planning-store"
import type { EmployeeCitationSources } from "@/features/employees/deletion"
import type { SectorCitationSources } from "@/features/sectors/deletion"
import { employeeService } from "@/features/employees/services/employee.service"

/**
 * Tout ce qui peut citer une fiche, rassemblé au moment de décider.
 *
 * Lu au clic plutôt que gardé en état : la question ne se pose qu'une fois par
 * suppression, et un état chargé au montage serait déjà périmé — quelqu'un a pu
 * publier une semaine depuis un autre onglet, et une décision irréversible ne
 * doit pas se prendre sur une lecture d'il y a dix minutes.
 */

/**
 * Les tours de permanence n'ont pas de « tout lister » : ils se lisent par
 * année. On balaie donc une fenêtre autour d'aujourd'hui plutôt que la totalité.
 *
 * C'est la seule des quatre familles qui ne soit pas parcourue entièrement, et
 * il faut le savoir : une fiche citée UNIQUEMENT dans un tour antérieur à cette
 * fenêtre passerait pour libre. Le risque est étroit — quelqu'un qui a tenu une
 * permanence a presque toujours aussi un planning ou une absence, tous deux
 * balayés en entier — et c'est de loin la citation la moins coûteuse à perdre.
 * L'élargir se fait ici, en une ligne.
 */
const PERMANENCE_YEARS_BACK = 3
const PERMANENCE_YEARS_FORWARD = 1

async function permanenceMonths() {
  const current = new Date().getFullYear()
  const years = []
  for (let year = current - PERMANENCE_YEARS_BACK; year <= current + PERMANENCE_YEARS_FORWARD; year += 1) {
    years.push(year)
  }
  const found = await Promise.all(years.map((year) => permanenceStore.year(year)))
  return found.flat()
}

export async function loadEmployeeCitationSources(): Promise<EmployeeCitationSources> {
  const [plannings, absences, permanences, leaveCampaigns] = await Promise.all([
    planningStore.records(),
    absenceService.list(),
    permanenceMonths(),
    paidLeaveStore.list(),
  ])
  return { plannings, absences, permanences, leaveCampaigns }
}

export async function loadSectorCitationSources(): Promise<SectorCitationSources> {
  const [employees, plannings, leaveCampaigns] = await Promise.all([
    employeeService.list(),
    planningStore.records(),
    paidLeaveStore.list(),
  ])
  return { employees, plannings, leaveCampaigns }
}
