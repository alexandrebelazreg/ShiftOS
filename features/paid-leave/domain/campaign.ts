import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  campaignWeeks,
  defaultPeriod,
} from "@/features/paid-leave/calendar/campaign-weeks"
import type {
  PaidLeaveCampaign,
  PaidLeaveEmployeeSettings,
  PaidLeavePeriodKind,
  PaidLeaveRequest,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

export function createPaidLeaveCampaign({
  id,
  year,
  kind,
  employees,
  sectors,
  previousCampaigns = [],
  now,
}: {
  readonly id: string
  readonly year: number
  readonly kind: PaidLeavePeriodKind
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly previousCampaigns?: readonly PaidLeaveCampaign[]
  readonly now: string
}): PaidLeaveCampaign {
  const period = defaultPeriod(kind)
  const weeks = campaignWeeks(year, period)
  const activeEmployees = employees.filter((employee) => employee.status === "active")
  const activeSectors = sectors.filter((sector) => sector.status === "active")
  const name = kind === "summer"
    ? `Été ${year}`
    : kind === "winter"
      ? `Hiver ${year}–${year + 1}`
      : `Période personnalisée ${year}`

  return {
    schemaVersion: 1,
    id,
    name,
    year,
    period,
    status: "editing",
    employeeSettings: Object.fromEntries(
      activeEmployees.map((employee) => [
        employee.id,
        defaultEmployeeSettings(employee, previousCampaigns),
      ])
    ),
    requests: Object.fromEntries(
      activeEmployees.map((employee) => [employee.id, emptyRequest(employee.id)])
    ),
    coverage: Object.fromEntries(
      activeSectors.map((sector) => [
        sector.id,
        Object.fromEntries(
          weeks.map((week) => [
            week.id,
            { minimumHours: 0, toleratedDeficitHours: 0 },
          ])
        ),
      ])
    ),
    reinforcementPools: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function synchronizePaidLeaveCampaign(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[],
  sectors: readonly SectorDemandConfiguration[],
  previousCampaigns: readonly PaidLeaveCampaign[]
): PaidLeaveCampaign {
  const weeks = campaignWeeks(campaign.year, campaign.period)
  const employeeSettings = { ...campaign.employeeSettings }
  const requests = { ...campaign.requests }
  for (const employee of employees.filter((item) => item.status === "active")) {
    employeeSettings[employee.id] ??= defaultEmployeeSettings(employee, previousCampaigns)
    requests[employee.id] ??= emptyRequest(employee.id)
  }

  const coverage = { ...campaign.coverage }
  for (const sector of sectors.filter((item) => item.status === "active")) {
    const existing = coverage[sector.id] ?? {}
    coverage[sector.id] = Object.fromEntries(
      weeks.map((week) => [
        week.id,
        existing[week.id] ?? { minimumHours: 0, toleratedDeficitHours: 0 },
      ])
    )
  }

  return { ...campaign, employeeSettings, requests, coverage }
}

/**
 * Les semaines de la campagne, en ensemble.
 *
 * Dérivée de la campagne plutôt que passée de main en main : c'est ce qui fait
 * que tous les lecteurs — solveur, validation, écran — comptent la même chose,
 * sans qu'aucun n'ait à se souvenir de la filtrer.
 */
export function campaignWeekIds(campaign: PaidLeaveCampaign): ReadonlySet<PaidLeaveWeekId> {
  return new Set(campaignWeeks(campaign.year, campaign.period).map((week) => week.id))
}

/**
 * Combien de semaines cette personne peut RÉELLEMENT obtenir.
 *
 * DÉDUIT des vœux : chaque rang est un plan complet de la même absence, donc le
 * nombre demandé est la taille d'un plan. Il n'existe plus de champ à remplir —
 * il en existait un, laissé à zéro par défaut, et une personne dont les vœux
 * s'affichaient à l'écran repartait avec un objectif nul et n'obtenait rien.
 *
 * Les semaines de la campagne sont exigées, et ce n'est pas un confort d'appel :
 * sans elles, cette fonction comptait des vœux que le solveur, lui, filtrait —
 * l'écart ne se refermait jamais et la campagne devenait invalidable à vie.
 *
 * Une demande absente vaut zéro plutôt que de lever : une fiche créée après la
 * campagne n'a pas encore de demande, et l'écran doit continuer à s'afficher.
 */
export function effectiveRequestedWeeks(
  request: PaidLeaveRequest | undefined,
  weekIds: ReadonlySet<PaidLeaveWeekId>
): number {
  // La taille du PLUS GRAND plan, et non celle du premier : un rang laissé
  // vide — ou plus court parce qu'une de ses semaines est tombée hors période —
  // ne doit pas rétrécir une demande que les autres rangs expriment en entier.
  // Quand les trois portent le même nombre, ce qui est le cas normal, le
  // maximum EST ce nombre.
  return Math.max(0, ...wishPlanSizes(request, weekIds))
}

/**
 * La taille de chacun des trois plans, semaines hors période exclues.
 *
 * Trois nombres et non un seul, parce que l'écart entre eux est une
 * information : trois plans de tailles différentes ne décrivent pas la même
 * absence, et c'est presque toujours une saisie inachevée.
 */
export function wishPlanSizes(
  request: PaidLeaveRequest | undefined,
  weekIds: ReadonlySet<PaidLeaveWeekId>
): readonly [number, number, number] {
  if (!request) return [0, 0, 0]
  const size = (weeks: readonly PaidLeaveWeekId[]) =>
    new Set(weeks.filter((weekId) => weekIds.has(weekId))).size
  return [size(request.wish1), size(request.wish2), size(request.wish3)]
}

/**
 * Les rangs remplis ne portent-ils pas tous le même nombre de semaines ?
 *
 * Un rang vide n'est pas une incohérence — on peut n'avoir qu'une seule idée.
 * Deux rangs remplis de tailles différentes en sont une.
 */
export function wishPlansDisagree(
  request: PaidLeaveRequest | undefined,
  weekIds: ReadonlySet<PaidLeaveWeekId>
): boolean {
  const filled = wishPlanSizes(request, weekIds).filter((size) => size > 0)
  return filled.length > 1 && new Set(filled).size > 1
}

/** Les vœux distincts que la campagne peut encore accorder. */
export function grantableWishes(
  request: PaidLeaveRequest | undefined,
  weekIds: ReadonlySet<PaidLeaveWeekId>
): readonly PaidLeaveWeekId[] {
  if (!request) return []
  return [...new Set([...request.wish1, ...request.wish2, ...request.wish3])].filter((weekId) =>
    weekIds.has(weekId)
  )
}

/**
 * Les vœux tombés HORS de la période, qu'aucune attribution ne peut satisfaire.
 *
 * Ils survivent à un changement de période — `invalidateCampaign` efface les
 * attributions, pas les souhaits — et il vaut mieux les nommer que les effacer :
 * le gérant a saisi ces semaines, c'est à lui de décider ce qu'elles deviennent.
 */
export function orphanedWishes(
  request: PaidLeaveRequest | undefined,
  weekIds: ReadonlySet<PaidLeaveWeekId>
): readonly PaidLeaveWeekId[] {
  if (!request) return []
  return [...new Set([...request.wish1, ...request.wish2, ...request.wish3])].filter(
    (weekId) => !weekIds.has(weekId)
  )
}

export function preferenceRank(
  request: PaidLeaveRequest,
  weekId: PaidLeaveWeekId
): 1 | 2 | 3 | null {
  if (request.wish1.includes(weekId)) return 1
  if (request.wish2.includes(weekId)) return 2
  if (request.wish3.includes(weekId)) return 3
  return null
}

/**
 * Cocher ou décocher une semaine dans un rang.
 *
 * Rien d'autre à tenir à jour : le nombre de semaines demandées se DÉDUIT de
 * ces listes. C'est ce qui rend l'oubli impossible.
 */
export function togglePaidLeaveWish(
  request: PaidLeaveRequest,
  rank: 1 | 2 | 3,
  weekId: PaidLeaveWeekId
): PaidLeaveRequest {
  const toggle = (weeks: readonly PaidLeaveWeekId[]) =>
    weeks.includes(weekId)
      ? weeks.filter((item) => item !== weekId)
      : [...weeks, weekId]

  if (rank === 1) return { ...request, wish1: toggle(request.wish1) }
  if (rank === 2) return { ...request, wish2: toggle(request.wish2) }
  return { ...request, wish3: toggle(request.wish3) }
}

export function grantIsEntirelyFirstChoice(
  request: PaidLeaveRequest,
  grants: readonly PaidLeaveWeekId[],
  weekIds: ReadonlySet<PaidLeaveWeekId>
): boolean {
  const target = effectiveRequestedWeeks(request, weekIds)
  return target > 0 && grants.length === target && grants.every((week) => request.wish1.includes(week))
}

export function linkPriorityEmployees(
  settings: Readonly<Record<string, PaidLeaveEmployeeSettings>>,
  employeeId: string,
  linkedEmployeeId: string | null
): Readonly<Record<string, PaidLeaveEmployeeSettings>> {
  const next = { ...settings }
  const current = next[employeeId]
  if (!current) return settings

  if (current.linkedEmployeeId && next[current.linkedEmployeeId]) {
    next[current.linkedEmployeeId] = {
      ...next[current.linkedEmployeeId],
      linkedEmployeeId: null,
    }
  }
  next[employeeId] = {
    ...current,
    linkedEmployeeId,
  }

  if (linkedEmployeeId && next[linkedEmployeeId]) {
    const previousPartner = next[linkedEmployeeId].linkedEmployeeId
    if (previousPartner && previousPartner !== employeeId && next[previousPartner]) {
      next[previousPartner] = {
        ...next[previousPartner],
        linkedEmployeeId: null,
      }
    }
    next[linkedEmployeeId] = {
      ...next[linkedEmployeeId],
      linkedEmployeeId: employeeId,
    }
  }
  return next
}

export function historyFromCampaigns(
  employeeId: string,
  campaigns: readonly PaidLeaveCampaign[]
): number {
  return campaigns.reduce(
    (count, campaign) =>
      count + (campaign.validatedSnapshot?.fullFirstChoiceEmployeeIds.includes(employeeId) ? 1 : 0),
    0
  )
}

function defaultEmployeeSettings(
  employee: EmployeeRecord,
  previousCampaigns: readonly PaidLeaveCampaign[]
): PaidLeaveEmployeeSettings {
  return {
    employeeId: employee.id,
    priority: false,
    linkedEmployeeId: null,
    entryDate: employee.createdAt.slice(0, 10),
    firstChoiceHistory: historyFromCampaigns(employee.id, previousCampaigns),
  }
}

function emptyRequest(employeeId: string): PaidLeaveRequest {
  return { employeeId, wish1: [], wish2: [], wish3: [] }
}
