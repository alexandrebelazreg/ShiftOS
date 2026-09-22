import {
  campaignWeeks,
  weekFromId,
} from "@/features/paid-leave/calendar/campaign-weeks"
import { activeClosureWeeks } from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"

/**
 * Ce que le code du travail dit d'une attribution, une fois qu'elle est posée.
 *
 * DEUX RÈGLES, ET AUCUNE DES DEUX N'EST UNE CONTRAINTE DU SOLVEUR. C'est une
 * décision, et elle mérite d'être dite : les deux se LISENT sur le résultat, et
 * les imposer rendrait infaisables des campagnes qui ne le sont pas.
 *
 * La continuité (L3141-19) se heurte à la couverture : quand le rayon ne peut
 * pas libérer deux semaines d'affilée, la choisir en contrainte ne produit pas
 * un congé légal, elle produit `infeasible` — c'est-à-dire rien, là où « voici
 * la meilleure attribution possible, et voici ce qu'elle a d'irrégulier » est
 * la seule réponse utile. L'étage `leave_blocks` pousse déjà vers le
 * regroupement sans jamais le payer de l'abandon de quelqu'un ; ce module dit
 * ce qui reste.
 *
 * Le fractionnement (L3141-23) n'est pas un défaut du tout : c'est un DROIT qui
 * s'ouvre au salarié. Il n'y a rien à optimiser, seulement quelque chose à ne
 * pas découvrir en paie.
 *
 * LA SEMAINE DE FERMETURE COMPTE COMME UN CONGÉ, parce qu'elle en est un. Une
 * fermeture entre Noël et le Nouvel An ouvre le droit au fractionnement aussi
 * sûrement qu'une semaine demandée, et une fermeture en août soude le congé
 * principal aussi bien qu'une semaine accordée.
 */

/** Le premier jour et le dernier de la période légale du congé principal. */
const MAIN_PERIOD_START = "05-01"
const MAIN_PERIOD_END = "10-31"

/**
 * Le congé principal ne dépasse pas vingt-quatre jours ouvrables (L3141-18),
 * soit quatre semaines de six jours. Au-delà, c'est la cinquième semaine, et
 * elle ne compte dans aucune des deux règles.
 */
export const MAIN_LEAVE_WEEK_CAP = 4

/**
 * Douze jours ouvrables consécutifs (L3141-19), soit deux semaines pleines.
 * En deçà de cette durée, le congé doit être continu ; au-delà, il peut être
 * fractionné pourvu qu'un morceau atteigne ce nombre.
 */
const CONTINUOUS_WEEKS_REQUIRED = 2

/** Du lundi au samedi. Le dimanche n'est pas un jour ouvrable. */
const WORKING_DAYS_PER_WEEK = 6

/**
 * Combien des six jours ouvrables de cette semaine tombent HORS période.
 *
 * COMPTÉS UN À UN, et pas déduits du lundi. Classer la semaine entière du côté
 * de son lundi paraît suffisant — c'est ce qui a été écrit d'abord — et c'est
 * faux là où ça compte le plus : la campagne d'été par défaut commence en S18,
 * qui court du lundi 27 avril au dimanche 3 mai 2026. Quatre de ses jours
 * ouvrables sont hors période, deux dedans. Arrondie à la semaine, elle en
 * porterait six et ouvrirait DEUX jours de fractionnement là où la loi n'en
 * donne qu'UN. Le cas n'a rien d'exotique : c'est la première semaine de la
 * période proposée à tout le monde.
 *
 * Six jours et non sept : le dimanche n'est pas un jour ouvrable, et le compter
 * ferait franchir un seuil à une semaine qui ne le franchit pas.
 */
export function outsideWorkingDays(weekId: PaidLeaveWeekId): number {
  const monday = new Date(`${weekFromId(weekId).start}T00:00:00.000Z`)
  let outside = 0
  for (let offset = 0; offset < WORKING_DAYS_PER_WEEK; offset += 1) {
    const day = new Date(monday)
    day.setUTCDate(monday.getUTCDate() + offset)
    const monthDay = day.toISOString().slice(5, 10)
    if (monthDay < MAIN_PERIOD_START || monthDay > MAIN_PERIOD_END) outside += 1
  }
  return outside
}

/**
 * Cette semaine fait-elle partie du congé principal ?
 *
 * DÈS QU'UN SEUL JOUR OUVRABLE TOMBE DANS LA PÉRIODE, et c'est la lecture
 * généreuse — délibérément. Cette fonction ne sert qu'à la règle de continuité,
 * dont la sanction est un reproche adressé au gérant : mieux vaut rattacher au
 * congé principal une semaine de frontière que d'accuser quelqu'un d'avoir coupé
 * un congé qu'il n'a pas coupé.
 *
 * Le fractionnement, lui, ne passe PAS par ici : il compte des jours, pas des
 * semaines, et c'est {@link outsideWorkingDays} qui le sert. Deux questions
 * différentes, deux fonctions — les confondre est précisément ce qui a produit
 * l'erreur d'un jour sur la S18.
 */
export function isMainLeaveWeek(weekId: PaidLeaveWeekId): boolean {
  return outsideWorkingDays(weekId) < WORKING_DAYS_PER_WEEK
}

export interface PaidLeaveLegalReading {
  readonly employeeId: string
  /** Tout ce que la personne pose : attributions ET fermeture, en ordre. */
  readonly leaveWeeks: readonly PaidLeaveWeekId[]
  /** Les semaines du congé principal, plafonné à quatre. */
  readonly mainLeaveWeeks: number
  /** Le plus long morceau d'un seul tenant, DANS la période légale. */
  readonly longestBlock: number
  /** Ce que la loi exige de ce morceau : une, ou deux semaines. */
  readonly requiredBlock: number
  /** Le congé principal est-il coupé en deçà de ce que la loi permet ? */
  readonly mainLeaveSplit: boolean
  /**
   * Les JOURS OUVRABLES du congé principal posés hors du 1er mai – 31 octobre.
   *
   * En jours et non en semaines, parce que l'article compte en jours et que ses
   * seuils — trois, puis six — tombent au milieu d'une semaine.
   */
  readonly daysOutsideMainPeriod: number
  /** Les jours ouvrables supplémentaires que cela ouvre (L3141-23). */
  readonly fractionationDays: number
}

/**
 * La lecture légale d'une attribution, personne par personne.
 *
 * Une seule fonction pour les deux règles, parce qu'elles partagent tout ce qui
 * est difficile : ce qui compte comme congé, ce qui compte comme principal, et
 * l'ordre des semaines dans la campagne. Les séparer obligerait à recalculer
 * trois fois la même chose, et c'est ainsi qu'on finit avec deux définitions du
 * congé principal.
 */
export function readPaidLeaveLegally(
  campaign: PaidLeaveCampaign,
  employeeId: string
): PaidLeaveLegalReading {
  const order = campaignWeeks(campaign.year, campaign.period).map((week) => week.id)
  const position = new Map(order.map((weekId, index) => [weekId, index]))
  const closed = activeClosureWeeks(campaign)
  const granted = new Set(campaign.grants[employeeId] ?? [])

  // Tout ce que la personne pose, dans l'ordre de la campagne. L'ordre du
  // CALENDRIER et non celui des numéros ISO : une campagne d'hiver passe de la
  // semaine 52 à la semaine 1, et trier sur le numéro y inverserait décembre et
  // janvier — la contiguïté deviendrait fausse là où elle compte le plus.
  const leaveWeeks = order.filter(
    (weekId) => granted.has(weekId) || closed.has(weekId)
  )

  // LE CONGÉ PRINCIPAL : les quatre premières semaines, chronologiquement.
  //
  // La loi ne dit pas LESQUELLES des cinq semaines forment le congé principal
  // quand une seule est hors période — elle laisse l'accord en décider. La
  // convention retenue ici est chronologique, et elle est la plus favorable au
  // salarié : la semaine hors période entre dans le congé principal au lieu
  // d'être désignée comme cinquième semaine, ce qui ouvre le droit au lieu de
  // l'éteindre. Un outil qui annonce un droit de trop se corrige d'un mot ; un
  // outil qui en cache un se découvre aux prud'hommes.
  const mainLeave = leaveWeeks.slice(0, MAIN_LEAVE_WEEK_CAP)
  const insidePeriod = mainLeave.filter((weekId) => isMainLeaveWeek(weekId))

  const longestBlock = longestRun(insidePeriod, position)
  const requiredBlock = Math.min(insidePeriod.length, CONTINUOUS_WEEKS_REQUIRED)
  const daysOutsideMainPeriod = mainLeave.reduce(
    (sum, weekId) => sum + outsideWorkingDays(weekId),
    0
  )

  return {
    employeeId,
    leaveWeeks,
    mainLeaveWeeks: mainLeave.length,
    longestBlock,
    requiredBlock,
    mainLeaveSplit: longestBlock < requiredBlock,
    daysOutsideMainPeriod,
    fractionationDays: fractionationDays(daysOutsideMainPeriod),
  }
}

/**
 * Les jours ouvrables gagnés pour avoir pris son congé principal hors saison.
 *
 * L'article L3141-23 en donne DEUX à partir de six jours ouvrables hors
 * période, et UN pour trois, quatre ou cinq. En deçà de trois, rien.
 *
 * Les deux seuils existent bel et bien ici, et c'est ce qui justifie de compter
 * des jours : une campagne d'été qui commence le lundi 27 avril place quatre
 * jours ouvrables hors période dès sa première semaine — un jour de
 * fractionnement, pas deux.
 */
function fractionationDays(daysOutside: number): number {
  if (daysOutside >= WORKING_DAYS_PER_WEEK) return 2
  return daysOutside >= 3 ? 1 : 0
}

/** Le plus long enchaînement de semaines voisines DANS la campagne. */
function longestRun(
  weekIds: readonly PaidLeaveWeekId[],
  position: ReadonlyMap<PaidLeaveWeekId, number>
): number {
  let longest = 0
  let current = 0
  let previous: number | null = null
  for (const weekId of weekIds) {
    const index = position.get(weekId)
    if (index === undefined) continue
    current = previous !== null && index === previous + 1 ? current + 1 : 1
    previous = index
    longest = Math.max(longest, current)
  }
  return longest
}
