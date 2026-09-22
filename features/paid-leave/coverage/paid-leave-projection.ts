import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import { absentWeeksByEmployee } from "@/features/paid-leave/domain/already-absent"
import {
  attributableWeekIds,
  campaignWeekIds,
  paidLeaveTargets,
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
  /**
   * Combien de personnes EN TROP par rapport au plafond, dans ce même scénario.
   *
   * Distinct des heures manquantes, et pas seulement pour la forme : des heures
   * de renfort comblent un plancher, elles ne ramènent personne sous un
   * plafond. Une semaine qui ne coince que par l'effectif ne se rachète pas,
   * elle se déplace.
   */
  readonly exceedingAbsent: number
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

/**
 * De combien quelqu'un a RECULÉ par rapport à son premier vœu.
 *
 * Ce type s'appelait `PaidLeaveCompromise`, exactement comme celui de
 * `models/paid-leave-campaign.ts` — deux formes incompatibles sous un seul nom,
 * toutes deux exportées. Rien ne cassait tant qu'aucun fichier n'importait les
 * deux ; le jour où l'un l'aurait fait, l'autre aurait été masqué en silence.
 *
 * Les deux mesurent d'ailleurs des choses différentes, et c'est ce que les noms
 * disent maintenant. Celui du modèle est le VERDICT d'une attribution — quels
 * rangs, mélange ou non, droit du couple tenu ou non, et la phrase à afficher —
 * et il est ENREGISTRÉ avec la campagne. Celui-ci est une MESURE d'écart entre
 * deux scénarios, recalculée à chaque rendu et jamais rangée.
 */
export interface PaidLeaveSetback {
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
  readonly setbacks: readonly PaidLeaveSetback[]
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
  absences = [],
}: {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  /** Ce qui est déjà posé ailleurs, et qu'aucun scénario ne peut ignorer. */
  readonly absences?: readonly AbsenceRecord[]
}): PaidLeaveProjection {
  const weekIds = campaignWeekIds(campaign)
  const active = employees.filter((employee) => employee.status === "active")

  // Le scénario de référence : la demande brute, sans arbitrage — mais pas sans
  // les absences déjà posées, qu'aucun vœu ne peut recouvrir.
  const wish1Grants = wishOneScenario(campaign, active, absences)
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
    // Une semaine peut coincer par les heures, par l'effectif, ou par les deux.
    // Ne garder que les heures laissait invisible une semaine que le solveur
    // refuse pourtant — la cellule était rouge et la liste vide.
    .filter((cell) => cell.deficitHours > 0 || cell.headcountBreach > 0)
    .map((cell) => ({
      sectorId: cell.sectorId,
      sectorName: cell.sectorName,
      weekId: cell.weekId,
      missingHours: cell.deficitHours,
      exceedingAbsent: cell.headcountBreach,
      wish1Requests: requestsByWeek.get(cell.weekId) ?? 0,
      reachableByPools: campaign.reinforcementPools.some((pool) => poolReaches(pool, cell.sectorId, cell.weekId)),
    }))
    .sort((left, right) =>
      right.missingHours - left.missingHours
      || right.exceedingAbsent - left.exceedingAbsent
      || left.weekId.localeCompare(right.weekId))

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
    satisfaction: countSatisfaction(campaign, active),
    mostContested: mostContestedWeek(requestsByWeek),
    setbacks: buildSetbacks(campaign, active, wish1Grants),
    ...splitEquity(campaign, active),
    ...buildRelief({ campaign, employees, sectors, wish1Grants }),
  }
}

export interface PaidLeaveTension {
  /** La situation en une phrase, lisible sans rien ouvrir. */
  readonly headline: string
  /** Ce qu'il faudrait pour la lever. `null` quand il n'y a rien à lever. */
  readonly remedy: string | null
  readonly critical: boolean
}

/**
 * La situation en deux phrases.
 *
 * Écrite ici et testée, parce que c'est le SEUL texte que le gérant lira
 * forcément : tout le reste de l'écran est repliable. Une carte qui empile six
 * blocs de chiffres minuscules ne dit rien ; une phrase qui donne le verdict et
 * son prix se lit en trois secondes, et le détail attend qu'on le demande.
 */
export function describePaidLeaveTension(projection: PaidLeaveProjection): PaidLeaveTension {
  const weeks = projection.criticalWeeks.length
  if (weeks === 0) {
    return {
      headline:
        "Tout le monde peut obtenir son premier vœu : aucune semaine ne passe sous son minimum de couverture.",
      remedy: null,
      critical: false,
    }
  }

  // DEUX FAÇONS DE COINCER, et une seule se rachète avec du renfort.
  //
  // La phrase parlait de « minimum de couverture » pour toutes les semaines
  // tendues. Depuis que le plafond d'effectif existe, une semaine peut coincer
  // sans qu'il manque une seule heure — et proposer d'y mettre du renfort
  // enverrait le gérant chercher un budget qui ne peut rien y faire.
  const parEffectif = projection.criticalWeeks.filter(
    (week) => week.exceedingAbsent > 0 && week.missingHours === 0
  ).length
  const parHeures = weeks - parEffectif

  const headline = parHeures === 0
    ? `${weeks} semaine${weeks > 1 ? "s" : ""} dépasserai${weeks > 1 ? "en" : ""}t le nombre `
      + `d'absents autorisés si chacun obtenait son premier vœu.`
    : parEffectif === 0
      ? `${weeks} semaine${weeks > 1 ? "s" : ""} passerai${weeks > 1 ? "en" : ""}t sous leur `
        + `minimum de couverture si chacun obtenait son premier vœu.`
      : `${weeks} semaines coinceraient si chacun obtenait son premier vœu : `
        + `${parHeures} sous leur minimum de couverture, ${parEffectif} par le nombre d'absents.`

  // Aucune heure de renfort ne ramène quelqu'un sous un plafond d'effectif : la
  // seule issue est de déplacer un congé.
  if (parHeures === 0) {
    return {
      headline,
      remedy: "Le renfort n'y peut rien : un plafond d'absents ne se rachète pas en heures, "
        + "il faut déplacer un congé.",
      critical: true,
    }
  }

  // Le remède, dans l'ordre où il se décide : d'abord l'argent s'il suffit,
  // ensuite ce qui manque, et enfin le cas où l'argent ne peut rien.
  const remedy =
    projection.reinforcementReachableHours === 0
      ? `Il faudrait ${formatHours(projection.reinforcementNeededHours)} de renfort, et aucune de vos `
        + `enveloppes n'atteint ces semaines : il faudra déplacer des congés.`
      : projection.reinforcementMissingHours === 0
        ? `Il faudrait ${formatHours(projection.reinforcementNeededHours)} de renfort, et vos enveloppes `
          + `peuvent les couvrir entièrement.`
        : `Il faudrait ${formatHours(projection.reinforcementNeededHours)} de renfort ; vos enveloppes en `
          + `couvrent ${formatHours(projection.reinforcementReachableHours)}, il en manque `
          + `${formatHours(projection.reinforcementMissingHours)}.`

  return { headline, remedy, critical: true }
}

function formatHours(value: number): string {
  return `${Math.round(value * 10) / 10} h`
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
function buildSetbacks(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[],
  wish1Grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
): readonly PaidLeaveSetback[] {
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
  employees: readonly EmployeeRecord[]
): {
  readonly neverFirstChoice: readonly PaidLeaveEquityWatch[]
  readonly repeatedFirstChoice: readonly PaidLeaveEquityWatch[]
} {
  const targetOf = paidLeaveTargets(campaign)
  const watches = employees
    .filter((employee) => targetOf(employee.id) > 0)
    .map((employee) => {
      const request = campaign.requests[employee.id]
      const granted = campaign.grants[employee.id] ?? []
      const target = targetOf(employee.id)
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
  employees: readonly EmployeeRecord[],
  absences: readonly AbsenceRecord[] = []
): Readonly<Record<string, readonly PaidLeaveWeekId[]>> {
  // Les semaines ATTRIBUABLES, et non celles de la campagne : le magasin fermé,
  // le scénario « chacun son vœu 1 » n'a rien à y placer, et l'y laisser compter
  // une absence de plus gonflerait une tension sur une semaine sans équipe.
  const weekIds = attributableWeekIds(campaign)
  const targetOf = paidLeaveTargets(campaign)
  // Une semaine d'arrêt ou de congé parental ne devient pas un congé payé parce
  // qu'on l'a souhaitée. Le scénario les écartait pourtant : il annonçait des
  // absences en double et surestimait la tension d'autant.
  const blocked = absentWeeksByEmployee(absences, campaignWeeks(campaign.year, campaign.period))
  return Object.fromEntries(
    employees.map((employee) => {
      const request = campaign.requests[employee.id]
      if (!request) return [employee.id, []]
      // Le scénario de référence ne peut pas offrir plus que le solde : un vœu
      // n'ouvre aucun droit, et surestimer la demande brute gonflerait la
      // tension d'autant.
      const target = targetOf(employee.id)
      const unavailable = blocked.get(employee.id)
      const wanted = [...new Set(request.wish1)].filter(
        (weekId) => weekIds.has(weekId) && !(unavailable?.has(weekId) ?? false)
      )
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
  employees: readonly EmployeeRecord[]
): PaidLeaveSatisfaction {
  let rank1 = 0
  let rank2 = 0
  let rank3 = 0
  let manual = 0
  let unservedEmployees = 0

  const targetOf = paidLeaveTargets(campaign)
  for (const employee of employees) {
    const request = campaign.requests[employee.id]
    const granted = campaign.grants[employee.id] ?? []
    if (granted.length === 0 && targetOf(employee.id) > 0) {
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
