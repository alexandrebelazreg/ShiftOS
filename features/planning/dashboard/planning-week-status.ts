import type { IsoDate } from "@/features/core/models"
import { listWeekOptions } from "@/features/planning/board"
import type { PlanningSummary } from "@/features/planning/persistence"

/**
 * Trois états, et un seul acte pour les traverser : enregistrer.
 *
 * Il y en avait quatre, parce qu'une semaine pouvait être enregistrée SANS être
 * publiée — deux gestes, deux significations. La publication a disparu de
 * l'écran de planning : enregistrer un rayon suffit désormais à le rendre
 * affichable, donc « enregistré » et « publié » disaient la même chose et l'un
 * des deux était de trop.
 *
 * Ce qui reste à distinguer n'est plus l'avancement d'UN planning mais la
 * couverture de la SEMAINE : aucun rayon, quelques-uns, tous.
 */
export const PLANNING_WEEK_STATES = ["untreated", "partial", "posted"] as const
export type PlanningWeekState = (typeof PLANNING_WEEK_STATES)[number]

/** Un rayon du magasin, tel que le tableau de bord a besoin de le nommer. */
export interface PlanningWeekSector {
  readonly id: string
  readonly name: string
}

export interface PlanningWeekStatus {
  readonly weekStart: IsoDate
  readonly weekNumber: number
  readonly offsetLabel: string
  readonly rangeLabel: string
  readonly state: PlanningWeekState
  readonly planningId?: string
  /** Les rayons enregistrés pour cette semaine, donc affichables. */
  readonly postedSectors: readonly string[]
  /** Ceux qui restent à faire. Vide quand la semaine est complète. */
  readonly missingSectors: readonly string[]
}

/** Resolve the store's calendar date without depending on the server's timezone. */
export function isoDateInTimeZone(now: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}` as IsoDate
}

/**
 * Build the dashboard horizon from the current week through S+6.
 *
 * Une semaine se planifie RAYON PAR RAYON, et le tableau de bord doit dire
 * lesquels sont faits. Il lisait auparavant le seul planning le plus récent :
 * traiter le Drive suffisait à peindre la semaine en vert alors que cinq rayons
 * restaient à faire — exactement le contraire de ce qu'un coup d'œil doit
 * apprendre.
 *
 * Le vert est donc réservé aux semaines COMPLÈTES. Dès qu'un rayon est
 * enregistré sans que tous le soient, la semaine passe au jaune et nomme ce
 * qui manque.
 *
 * Sans liste de rayons — magasin pas encore configuré — on ne peut rien dire
 * de la complétude : mieux vaut une couleur approximative qu'un tableau vide.
 */
export function buildPlanningWeekStatuses(
  today: IsoDate,
  plannings: readonly PlanningSummary[],
  sectors: readonly PlanningWeekSector[] = [],
  weekCount = 7
): PlanningWeekStatus[] {
  const options = listWeekOptions(today, 0, Math.max(0, weekCount - 1))

  return options.map((option, index) => {
    const ofWeek = plannings.filter((planning) => planning.periodStart === option.value)
    const latest = [...ofWeek].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]

    // Un rayon est fait dès qu'un planning l'a couvert.
    //
    // Le statut ne sert plus à trancher : un enregistrement EXISTE parce que
    // quelqu'un a cliqué « Enregistrer », et c'est tout ce que la semaine a
    // besoin de savoir. Les `published` et `archived` d'avant se lisent donc
    // comme des enregistrements, sans qu'une ligne de base soit réécrite.
    const posted = sectors.filter((sector) =>
      ofWeek.some((planning) => (planning.sectorIds ?? []).includes(sector.id))
    )
    const postedIds = new Set(posted.map((sector) => sector.id))
    const missing = sectors.filter((sector) => !postedIds.has(sector.id))

    return {
      weekStart: option.value,
      weekNumber: option.weekNumber,
      offsetLabel: index === 0 ? "Cette semaine" : `S+${index}`,
      rangeLabel: option.label.replace(/^S\d+ · /, ""),
      state: stateOf(sectors.length, posted.length, missing.length, latest),
      postedSectors: posted.map((sector) => sector.name),
      missingSectors: missing.map((sector) => sector.name),
      ...(latest ? { planningId: latest.id } : {}),
    }
  })
}

function stateOf(
  sectorCount: number,
  postedCount: number,
  missingCount: number,
  latest: PlanningSummary | undefined
): PlanningWeekState {
  if (!latest) return "untreated"

  // Aucun rayon connu — magasin pas encore configuré. On ne peut rien dire de
  // la complétude, et un planning existe : mieux vaut le vert approximatif
  // qu'un tableau qui prétend qu'il reste du travail sans savoir lequel.
  if (sectorCount === 0) return "posted"

  // Un rayon enregistré sur huit n'est PAS une semaine faite. Le vert dit
  // « il n'y a plus rien à faire ici », et c'est la seule chose qu'un coup
  // d'œil au tableau de bord doit apprendre.
  if (postedCount === 0) return "untreated"
  return missingCount === 0 ? "posted" : "partial"
}
