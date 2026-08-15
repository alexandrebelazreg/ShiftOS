import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import {
  campaignWeekIds,
  effectiveRequestedWeeks,
  preferenceRank,
} from "@/features/paid-leave/domain/campaign"
import {
  calculatePaidLeaveCoverage,
  type PaidLeaveCoverageSummary,
} from "@/features/paid-leave/coverage/paid-leave-coverage"
import type {
  PaidLeaveCampaign,
  PaidLeaveReinforcementPool,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Ce que l'arbitrage coûte, avant de le rendre.
 *
 * La couverture répond « est-ce que ça passe ? ». Elle ne répond pas aux
 * questions qu'un gérant se pose EN NÉGOCIANT : quelles semaines sont
 * intenables si chacun a son premier vœu, combien d'heures de renfort il
 * faudrait pour que ce soit tenable, et si les enveloppes déjà budgétées ont
 * seulement servi. Sans ces chiffres, arbitrer, c'est deviner.
 *
 * Tout est calculé sur DEUX scénarios comparés : « tout le monde en vœu 1 »,
 * qui est la demande brute de l'équipe, et la proposition en cours. L'écart
 * entre les deux EST le compromis, et le nommer en heures le rend discutable.
 */

export interface PaidLeaveCriticalWeek {
  readonly sectorId: string
  readonly sectorName: string
  readonly weekId: PaidLeaveWeekId
  /** Ce qui manque pour atteindre le minimum, si chacun a son vœu 1. */
  readonly missingHours: number
  /** Combien de personnes réclament cette semaine en premier vœu. */
  readonly wish1Requests: number
  /** Des heures de renfort peuvent-elles seulement atteindre cette semaine ? */
  readonly reachableByPools: boolean
}

export interface PaidLeavePoolReport {
  readonly poolId: string
  readonly label: string
  readonly totalHours: number
  readonly usedHours: number
  readonly remainingHours: number
  /**
   * L'enveloppe peut-elle servir sur au moins une semaine critique ?
   *
   * Une enveloppe dont la fenêtre ne croise aucune semaine tendue est du
   * budget qui ne servira jamais — et c'est invisible tant qu'on ne regarde
   * que « combien reste-t-il ».
   */
  readonly usefulOnCriticalWeeks: boolean
}

export interface PaidLeaveSatisfaction {
  readonly rank1: number
  readonly rank2: number
  readonly rank3: number
  /** Semaines accordées hors de tout vœu — un arbitrage manuel. */
  readonly manual: number
  /** Personnes n'ayant obtenu aucune semaine alors qu'elles en demandaient. */
  readonly unservedEmployees: number
}

export interface PaidLeaveCompromise {
  readonly employeeId: string
  readonly name: string
  /** Semaines demandées en premier vœu et effectivement obtenues. */
  readonly keptFromWish1: number
  /** Semaines de son premier vœu qu'il a fallu déplacer. */
  readonly movedWeeks: number
  /** Le rang le moins bon qu'il ait accepté. `null` s'il n'a rien obtenu. */
  readonly worstRank: 1 | 2 | 3 | null
}

export interface PaidLeaveEquityWatch {
  readonly employeeId: string
  readonly name: string
  /** Combien de fois cette personne a déjà eu son premier vœu, campagnes passées. */
  readonly previousFirstChoices: number
  /** Est-elle entièrement servie au premier vœu cette fois-ci ? */
  readonly firstChoiceNow: boolean
}

export interface PaidLeaveProjection {
  /** Les semaines qui ne tiennent pas si chacun obtient son premier vœu. */
  readonly criticalWeeks: readonly PaidLeaveCriticalWeek[]
  /** Le renfort à trouver pour que ce scénario tienne partout. */
  readonly reinforcementNeededHours: number
  /** Ce que les enveloppes existantes peuvent y consacrer, fenêtres comprises. */
  readonly reinforcementReachableHours: number
  /** Ce qui manquerait encore. Zéro veut dire « le budget suffit ». */
  readonly reinforcementMissingHours: number
  readonly pools: readonly PaidLeavePoolReport[]
  /** Vrai quand la proposition consomme toutes les heures budgétées. */
  readonly poolsFullyUsed: boolean
  readonly satisfaction: PaidLeaveSatisfaction
  /** La semaine la plus réclamée en premier vœu. */
  readonly mostContested: { readonly weekId: PaidLeaveWeekId; readonly requests: number } | null
  /** Qui a reculé, et de combien. Les plus touchés en tête. */
  readonly compromises: readonly PaidLeaveCompromise[]
  /**
   * Ceux qui n'ont JAMAIS eu leur premier vœu et ne l'ont pas non plus cette
   * fois. L'injustice d'une campagne se rattrape ; celle qui se répète, non.
   */
  readonly neverFirstChoice: readonly PaidLeaveEquityWatch[]
  /** Ceux qui l'obtiennent encore alors qu'ils l'ont déjà eu. */
  readonly repeatedFirstChoice: readonly PaidLeaveEquityWatch[]
  /** Ce que rendrait un minimum de couverture abaissé. */
  readonly relief: readonly PaidLeaveReliefStep[]
  /**
   * De combien il faudrait abaisser chaque minimum pour que la demande brute
   * passe SANS renfort. `null` quand aucun palier essayé n'y suffit.
   */
  readonly reliefThresholdHours: number | null
}

export interface PaidLeaveReliefStep {
  readonly deltaHours: number
  readonly criticalWeeks: number
  readonly reinforcementNeededHours: number
}

/**
 * Les paliers essayés, en heures retirées à chaque minimum.
 *
 * Sept heures valent une journée d'une personne, trente-cinq une semaine
 * entière : les paliers parlent en gestes réels — « je tiens un jour de moins »,
 * « je me passe d'une personne » — et non en pourcentages abstraits.
 */
const RELIEF_STEPS = [7, 14, 21, 35] as const

export function buildPaidLeaveProjection({
  campaign,
  employees,
  sectors,
}: {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
}): PaidLeaveProjection {
  const weekIds = campaignWeekIds(campaign)
  const active = employees.filter((employee) => employee.status === "active")

  // Le scénario de référence : la demande brute, sans arbitrage.
  const wish1Grants = wishOneScenario(campaign, active)
  const projected = calculatePaidLeaveCoverage({
    campaign,
    employees,
    sectors,
    grants: wish1Grants,
    // AUCUN renfort placé : on veut le manque NU, celui qu'il faudrait couvrir.
    reinforcementAllocations: [],
  })

  const requestsByWeek = countWish1Requests(campaign, active, weekIds)
  const criticalWeeks: PaidLeaveCriticalWeek[] = projected.cells
    .filter((cell) => cell.deficitHours > 0)
    .map((cell) => ({
      sectorId: cell.sectorId,
      sectorName: cell.sectorName,
      weekId: cell.weekId,
      missingHours: cell.deficitHours,
      wish1Requests: requestsByWeek.get(cell.weekId) ?? 0,
      reachableByPools: campaign.reinforcementPools.some((pool) => poolReaches(pool, cell.sectorId, cell.weekId)),
    }))
    .sort((left, right) => right.missingHours - left.missingHours || left.weekId.localeCompare(right.weekId))

  const reinforcementNeededHours = round(
    criticalWeeks.reduce((sum, week) => sum + week.missingHours, 0)
  )
  const reinforcementReachableHours = round(
    reachableHours(campaign.reinforcementPools, criticalWeeks)
  )

  // La proposition en cours, pour lire ce que le renfort a réellement servi.
  const current: PaidLeaveCoverageSummary = calculatePaidLeaveCoverage({
    campaign,
    employees,
    sectors,
    reinforcementAllocations: campaign.solution?.reinforcementAllocations,
  })

  const pools: PaidLeavePoolReport[] = current.pools.map((pool) => {
    const declared = campaign.reinforcementPools.find((entry) => entry.id === pool.poolId)
    return {
      ...pool,
      usefulOnCriticalWeeks:
        declared !== undefined
        && criticalWeeks.some((week) => poolReaches(declared, week.sectorId, week.weekId)),
    }
  })

  return {
    criticalWeeks,
    reinforcementNeededHours,
    reinforcementReachableHours,
    reinforcementMissingHours: round(
      Math.max(0, reinforcementNeededHours - reinforcementReachableHours)
    ),
    pools,
    poolsFullyUsed: pools.length > 0 && pools.every((pool) => pool.remainingHours === 0),
    satisfaction: countSatisfaction(campaign, active, weekIds),
    mostContested: mostContestedWeek(requestsByWeek),
    compromises: buildCompromises(campaign, active, wish1Grants),
    ...splitEquity(campaign, active, weekIds),
    ...buildRelief({ campaign, employees, sectors, wish1Grants }),
  }
}

/**
 * Ce que rendrait un minimum de couverture abaissé.
 *
 * Le seul levier que le gérant tient VRAIMENT en main. Il peut négocier un vœu,
 * mais il décide seul de descendre un minimum d'une journée — et jusqu'ici cette
 * décision était aveugle : rien ne disait ce qu'elle rachèterait.
 *
 * Un balayage plutôt qu'un curseur : la question n'est pas « que se passe-t-il à
 * moins douze heures » mais « à partir de quand ça passe », et une liste de
 * paliers y répond d'un coup d'œil, sans rien à manipuler.
 */
function buildRelief({
  campaign,
  employees,
  sectors,
  wish1Grants,
}: {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly wish1Grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
}): {
  readonly relief: readonly PaidLeaveReliefStep[]
  readonly reliefThresholdHours: number | null
} {
  const relief: PaidLeaveReliefStep[] = []
  let threshold: number | null = null

  for (const deltaHours of RELIEF_STEPS) {
    const cells = calculatePaidLeaveCoverage({
      campaign: withRelaxedMinimums(campaign, deltaHours),
      employees,
      sectors,
      grants: wish1Grants,
      reinforcementAllocations: [],
    }).cells.filter((cell) => cell.deficitHours > 0)

    relief.push({
      deltaHours,
      criticalWeeks: cells.length,
      reinforcementNeededHours: round(cells.reduce((sum, cell) => sum + cell.deficitHours, 0)),
    })
    if (cells.length === 0) {
      threshold = deltaHours
      break // Inutile d'essayer plus bas : on cherche le premier palier qui suffit.
    }
  }

  return { relief, reliefThresholdHours: threshold }
}

/** La même campagne, chaque minimum abaissé — jamais sous zéro. */
export function withRelaxedMinimums(
  campaign: PaidLeaveCampaign,
  deltaHours: number
): PaidLeaveCampaign {
  return {
    ...campaign,
    coverage: Object.fromEntries(
      Object.entries(campaign.coverage).map(([sectorId, weeks]) => [
        sectorId,
        Object.fromEntries(
          Object.entries(weeks).map(([weekId, rule]) => [
            weekId,
            { ...rule, minimumHours: Math.max(0, rule.minimumHours - deltaHours) },
          ])
        ),
      ])
    ),
  }
}

/**
 * Ce que chacun a dû lâcher, en semaines.
 *
 * Le compromis se lit par DIFFÉRENCE entre son premier vœu et ce qu'il obtient,
 * jamais par le rang seul : quelqu'un servi « en vœu 2 » sur une semaine qu'il
 * réclamait aussi en vœu 1 n'a rien perdu, et le rang le dirait pourtant.
 */
function buildCompromises(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[],
  wish1Grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
): readonly PaidLeaveCompromise[] {
  return employees
    .map((employee) => {
      const wanted = new Set(wish1Grants[employee.id] ?? [])
      const granted = campaign.grants[employee.id] ?? []
      const request = campaign.requests[employee.id]
      const kept = granted.filter((weekId) => wanted.has(weekId)).length
      const ranks = granted
        .map((weekId) => (request ? preferenceRank(request, weekId) : null))
        .filter((rank): rank is 1 | 2 | 3 => rank !== null)
      return {
        employeeId: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        keptFromWish1: kept,
        movedWeeks: Math.max(0, wanted.size - kept),
        worstRank: ranks.length > 0 ? (Math.max(...ranks) as 1 | 2 | 3) : null,
      }
    })
    .filter((entry) => entry.movedWeeks > 0)
    .sort((left, right) => right.movedWeeks - left.movedWeeks || left.name.localeCompare(right.name))
}

/**
 * L'équité qui traverse les campagnes.
 *
 * `firstChoiceHistory` nourrit déjà le solveur, mais rien ne le MONTRAIT : le
 * gérant ne pouvait pas voir qui accumule les refus d'une année sur l'autre,
 * alors que c'est le seul arbitrage qu'on lui reprochera vraiment.
 */
function splitEquity(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[],
  weekIds: ReadonlySet<PaidLeaveWeekId>
): {
  readonly neverFirstChoice: readonly PaidLeaveEquityWatch[]
  readonly repeatedFirstChoice: readonly PaidLeaveEquityWatch[]
} {
  const watches = employees
    .filter((employee) => effectiveRequestedWeeks(campaign.requests[employee.id], weekIds) > 0)
    .map((employee) => {
      const request = campaign.requests[employee.id]
      const granted = campaign.grants[employee.id] ?? []
      const target = effectiveRequestedWeeks(request, weekIds)
      const atRank1 =
        granted.length === target
        && granted.every((weekId) => (request ? preferenceRank(request, weekId) : null) === 1)
      return {
        employeeId: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        previousFirstChoices: campaign.employeeSettings?.[employee.id]?.firstChoiceHistory ?? 0,
        firstChoiceNow: atRank1,
      }
    })

  return {
    neverFirstChoice: watches
      .filter((watch) => watch.previousFirstChoices === 0 && !watch.firstChoiceNow)
      .sort((left, right) => left.name.localeCompare(right.name)),
    repeatedFirstChoice: watches
      .filter((watch) => watch.previousFirstChoices > 0 && watch.firstChoiceNow)
      .sort((left, right) => right.previousFirstChoices - left.previousFirstChoices || left.name.localeCompare(right.name)),
  }
}

/**
 * Ce que donnerait « chacun son premier vœu ».
 *
 * Les semaines hors période sont écartées, et on n'en prend jamais plus que la
 * demande : un premier vœu plus long que le nombre dû décrirait une absence que
 * personne n'a demandée.
 */
export function wishOneScenario(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[]
): Readonly<Record<string, readonly PaidLeaveWeekId[]>> {
  const weekIds = campaignWeekIds(campaign)
  return Object.fromEntries(
    employees.map((employee) => {
      const request = campaign.requests[employee.id]
      if (!request) return [employee.id, []]
      const target = effectiveRequestedWeeks(request, weekIds)
      const wanted = [...new Set(request.wish1)].filter((weekId) => weekIds.has(weekId))
      return [employee.id, wanted.slice(0, target)]
    })
  )
}

function countWish1Requests(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[],
  weekIds: ReadonlySet<PaidLeaveWeekId>
): Map<PaidLeaveWeekId, number> {
  const counts = new Map<PaidLeaveWeekId, number>()
  for (const employee of employees) {
    const request = campaign.requests[employee.id]
    if (!request) continue
    for (const weekId of new Set(request.wish1)) {
      if (!weekIds.has(weekId)) continue
      counts.set(weekId, (counts.get(weekId) ?? 0) + 1)
    }
  }
  return counts
}

function countSatisfaction(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[],
  weekIds: ReadonlySet<PaidLeaveWeekId>
): PaidLeaveSatisfaction {
  let rank1 = 0
  let rank2 = 0
  let rank3 = 0
  let manual = 0
  let unservedEmployees = 0

  for (const employee of employees) {
    const request = campaign.requests[employee.id]
    const granted = campaign.grants[employee.id] ?? []
    if (granted.length === 0 && effectiveRequestedWeeks(request, weekIds) > 0) {
      unservedEmployees += 1
    }
    for (const weekId of granted) {
      const rank = request ? preferenceRank(request, weekId) : null
      if (rank === 1) rank1 += 1
      else if (rank === 2) rank2 += 1
      else if (rank === 3) rank3 += 1
      else manual += 1
    }
  }

  return { rank1, rank2, rank3, manual, unservedEmployees }
}

function mostContestedWeek(
  counts: ReadonlyMap<PaidLeaveWeekId, number>
): { readonly weekId: PaidLeaveWeekId; readonly requests: number } | null {
  let best: { weekId: PaidLeaveWeekId; requests: number } | null = null
  for (const [weekId, requests] of counts) {
    if (best === null || requests > best.requests || (requests === best.requests && weekId < best.weekId)) {
      best = { weekId, requests }
    }
  }
  return best !== null && best.requests > 1 ? best : null
}

/**
 * Les heures d'enveloppe réellement mobilisables sur les semaines critiques.
 *
 * Une enveloppe ne se compte qu'une fois même si elle couvre plusieurs semaines
 * tendues : c'est un budget, pas une capacité par semaine. La plafonner au
 * besoin évite d'annoncer un surplus qui n'en est pas un.
 */
function reachableHours(
  pools: readonly PaidLeaveReinforcementPool[],
  criticalWeeks: readonly PaidLeaveCriticalWeek[]
): number {
  const need = criticalWeeks.reduce((sum, week) => sum + week.missingHours, 0)
  const available = pools
    .filter((pool) => criticalWeeks.some((week) => poolReaches(pool, week.sectorId, week.weekId)))
    .reduce((sum, pool) => sum + Math.max(0, pool.totalHours), 0)
  return Math.min(need, available)
}

function poolReaches(
  pool: PaidLeaveReinforcementPool,
  sectorId: string,
  weekId: PaidLeaveWeekId
): boolean {
  const inWindow = pool.startWeekId <= weekId && weekId <= pool.endWeekId
  return inWindow && (pool.scope === "global" || pool.sectorId === sectorId)
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Les semaines de la campagne, pour qui veut aligner un tableau dessus. */
export function projectionWeeks(campaign: PaidLeaveCampaign) {
  return campaignWeeks(campaign.year, campaign.period)
}
