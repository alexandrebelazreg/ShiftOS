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
            { minimumHours: 0, toleratedDeficitHours: 0, maximumAbsent: null },
          ])
        ),
      ])
    ),
    reinforcementPools: [],
    closureWeekIds: [],
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
        existing[week.id] ?? { minimumHours: 0, toleratedDeficitHours: 0, maximumAbsent: null },
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
 * Les semaines de fermeture qui s'appliquent VRAIMENT à cette campagne.
 *
 * Filtrées par la période, et le nom le dit : un changement de période laisse
 * derrière lui des semaines de fermeture devenues hors champ, et les compter
 * décompterait du solde une fermeture qui n'a plus lieu ici.
 *
 * Pas `closureWeekIds`, qui serait le nom évident : ce nom est déjà celui du
 * CHAMP, dont le contenu n'est pas filtré. Deux choses différentes sous un seul
 * nom finissent toujours par être confondues — c'est arrivé ici même avec
 * `PaidLeaveCompromise`, et on ne le refait pas.
 */
export function activeClosureWeeks(
  campaign: PaidLeaveCampaign
): ReadonlySet<PaidLeaveWeekId> {
  const weeks = campaignWeekIds(campaign)
  return new Set((campaign.closureWeekIds ?? []).filter((weekId) => weeks.has(weekId)))
}

/**
 * Les semaines que la campagne peut encore ATTRIBUER — la période moins la
 * fermeture.
 *
 * DEUX ENSEMBLES, ET LA DIFFÉRENCE EST TOUT LE SUJET. « Dans la campagne » et
 * « attribuable » ne veulent pas dire la même chose dès qu'une fermeture existe :
 * un vœu posé sur une semaine de fermeture n'est pas HORS PÉRIODE — il est sans
 * objet, puisque la personne sera de toute façon en congé. Les confondre
 * transformerait ce vœu en vœu orphelin et ferait dire à l'écran qu'une semaine
 * demandée est tombée hors de la campagne, ce qui est faux.
 *
 * D'où la règle : qui demande « le solveur peut-il placer ici ? » passe cet
 * ensemble ; qui demande « cette semaine est-elle dans la campagne ? » passe
 * {@link campaignWeekIds}. `orphanedWishes` est du second genre, et c'est le
 * seul.
 */
export function attributableWeekIds(
  campaign: PaidLeaveCampaign
): ReadonlySet<PaidLeaveWeekId> {
  const closed = activeClosureWeeks(campaign)
  return new Set([...campaignWeekIds(campaign)].filter((weekId) => !closed.has(weekId)))
}

/**
 * Ce qu'il reste à poser APRÈS la fermeture.
 *
 * La fermeture consomme le solde comme n'importe quel congé : deux semaines
 * fermées sur un solde de cinq en laissent trois à arbitrer. Sans cette
 * soustraction, la campagne accorderait cinq semaines À CÔTÉ de la fermeture, et
 * la personne en aurait posé sept.
 *
 * `null` traverse : pas de solde connu, donc rien à vérifier — et surtout pas un
 * zéro fabriqué par la soustraction, qui fermerait la campagne à tout le monde
 * dès qu'une semaine de fermeture existe.
 */
export function remainingEntitlementWeeks(
  entitlementWeeks: number | null | undefined,
  closureCount: number
): number | null {
  if (entitlementWeeks === null || entitlementWeeks === undefined) return null
  return Math.max(0, Math.floor(entitlementWeeks) - closureCount)
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
 * Combien de semaines on peut RÉELLEMENT lui accorder.
 *
 * Trois bornes, et la troisième est nouvelle : ce qu'elle a demandé, ce que ses
 * vœux offrent encore, et ce qu'il lui RESTE À POSER. Rien ne vérifiait la
 * dernière — la cible venait du vœu, jamais d'un droit — si bien qu'une campagne
 * pouvait accorder cinq semaines à quelqu'un qui n'en avait plus que trois. La
 * paie le découvrait après.
 *
 * Une seule définition pour tout l'écran : la cible du solveur, le compteur
 * « x / y accordées », le raccourci « Accorder V1 » et le scénario de référence
 * la partagent. Deux façons de dire « combien peut-il en obtenir » finiraient
 * par diverger, et l'écart ne se verrait qu'à la validation.
 *
 * `null` vaut « pas de solde connu » : la borne disparaît, et le calcul est
 * exactement celui d'avant ce champ.
 */
export function grantableWeekCount(
  request: PaidLeaveRequest | undefined,
  weekIds: ReadonlySet<PaidLeaveWeekId>,
  entitlementWeeks?: number | null
): number {
  const wanted = Math.min(
    effectiveRequestedWeeks(request, weekIds),
    grantableWishes(request, weekIds).length
  )
  if (entitlementWeeks === null || entitlementWeeks === undefined) return wanted
  return Math.max(0, Math.min(wanted, Math.floor(entitlementWeeks)))
}

/**
 * LA CIBLE D'UNE PERSONNE DANS CETTE CAMPAGNE — une seule définition, partout.
 *
 * Quatre bornes, et aucune ne se devine : ce qu'elle a demandé, ce que ses vœux
 * offrent encore, ce qu'il lui reste à poser, et ce que la fermeture a déjà
 * consommé. Quatre endroits les composaient séparément — le contrat du solveur,
 * le scénario de référence, le partage d'équité et le compte rendu — et il a
 * suffi d'ajouter la quatrième pour que trois d'entre eux se trompent.
 *
 * UNE FABRIQUE, ET NON UNE FONCTION PAR APPEL : les deux ensembles de semaines
 * et le nombre de semaines fermées ne dépendent pas du salarié. Les recalculer
 * soixante fois serait sans conséquence mesurable, mais offrirait à chaque
 * appelant la tentation de les calculer lui-même « pour aller plus vite », et
 * c'est ainsi que les définitions divergent.
 */
export function paidLeaveTargets(
  campaign: PaidLeaveCampaign
): (employeeId: string) => number {
  const attributable = attributableWeekIds(campaign)
  const closureCount = activeClosureWeeks(campaign).size
  return (employeeId) =>
    grantableWeekCount(
      campaign.requests[employeeId],
      attributable,
      remainingEntitlementWeeks(
        campaign.employeeSettings?.[employeeId]?.entitlementWeeks,
        closureCount
      )
    )
}

/**
 * Les attributions sont-elles encore celles que le calcul a rendues ?
 *
 * La question se pose à CHAQUE fois qu'on veut confronter quelque chose à la
 * solution : la liste des servis au premier vœu, le prix des concessions. Ces
 * nombres ne valent que pour la campagne que le solveur a produite ; dès que le
 * gérant déplace une semaine à la main, ils parlent d'un état qui n'existe plus.
 *
 * Les afficher quand même promettrait un gain sur une référence disparue, et
 * ferait crier un avertissement à chaque retouche — un avertissement qui crie à
 * tort est un avertissement qu'on apprend à ignorer.
 */
export function grantsMatchSolution(campaign: PaidLeaveCampaign): boolean {
  const solved = campaign.solution?.grants
  if (!solved) return false
  const keys = new Set([...Object.keys(solved), ...Object.keys(campaign.grants)])
  for (const key of keys) {
    const before = [...(solved[key] ?? [])].sort()
    const after = [...(campaign.grants[key] ?? [])].sort()
    if (before.length !== after.length) return false
    if (before.some((weekId, index) => weekId !== after[index])) return false
  }
  return true
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
    // Inconnu tant que le gérant ne l'a pas saisi : on ne l'invente pas.
    entitlementWeeks: null,
  }
}

function emptyRequest(employeeId: string): PaidLeaveRequest {
  return { employeeId, wish1: [], wish2: [], wish3: [] }
}
