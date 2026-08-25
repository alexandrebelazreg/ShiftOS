import type { IsoDate } from "@/features/core/models"
import { listWeekOptions } from "@/features/planning/board"
import type { PlanningSummary } from "@/features/planning/persistence"

export const PLANNING_WEEK_STATES = ["untreated", "saved", "partial", "published"] as const
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
  /** Les rayons publiés pour cette semaine. */
  readonly publishedSectors: readonly string[]
  /** Ceux qui restent à publier. Vide quand la semaine est complète. */
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
 * publier le Drive suffisait à peindre la semaine en vert alors que cinq rayons
 * restaient à traiter — exactement le contraire de ce qu'un coup d'œil doit
 * apprendre.
 *
 * Le vert est donc réservé aux semaines COMPLÈTES. Dès qu'un rayon est publié
 * sans que tous le soient, la semaine passe au jaune et nomme ce qui manque.
 *
 * Sans liste de rayons — magasin pas encore configuré — on retombe sur la
 * lecture d'avant : un planning publié suffit. Mieux vaut une couleur
 * approximative qu'un tableau vide.
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

    // Un rayon est publié quand SON planning le plus récent l'est.
    //
    // Regarder « existe-t-il un planning publié » suffirait presque, mais
    // rouvrir une semaine publiée en crée un brouillon plus récent sans
    // toucher à l'original : le rayon repasserait alors pour terminé alors que
    // quelqu'un est en train de le refaire. C'est le dernier état qui compte.
    const published = sectors.filter((sector) => {
      const latestForSector = ofWeek
        .filter((planning) => (planning.sectorIds ?? []).includes(sector.id))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
      return latestForSector?.status === "published"
    })
    const publishedIds = new Set(published.map((sector) => sector.id))
    const missing = sectors.filter((sector) => !publishedIds.has(sector.id))

    return {
      weekStart: option.value,
      weekNumber: option.weekNumber,
      offsetLabel: index === 0 ? "Cette semaine" : `S+${index}`,
      rangeLabel: option.label.replace(/^S\d+ · /, ""),
      state: stateOf(sectors.length, published.length, missing.length, ofWeek, latest),
      publishedSectors: published.map((sector) => sector.name),
      missingSectors: missing.map((sector) => sector.name),
      ...(latest ? { planningId: latest.id } : {}),
    }
  })
}

function stateOf(
  sectorCount: number,
  publishedCount: number,
  missingCount: number,
  ofWeek: readonly PlanningSummary[],
  latest: PlanningSummary | undefined
): PlanningWeekState {
  if (!latest) return "untreated"

  // Aucun rayon connu : on ne peut rien dire de la complétude, donc on s'en
  // tient à la lecture d'avant — l'état du planning le plus récent.
  if (sectorCount === 0) {
    return latest.status === "published" ? "published" : "saved"
  }

  if (publishedCount === 0) return "saved"
  return missingCount === 0 ? "published" : "partial"
}
