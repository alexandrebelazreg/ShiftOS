import type { IsoDate } from "@/features/core/models"
import type { PlanningBoardInput } from "@/features/planning/board"

/**
 * Ce qu'un gérant choisit avant d'imprimer la feuille affichée au mur.
 *
 * Trois lectures de la MÊME semaine, jamais trois plannings : la feuille sort
 * du planning à l'écran, celui qu'on vient de relire, et non d'une seconde
 * source qui pourrait en différer d'une retouche.
 */

/**
 * Comment la semaine est découpée sur le papier.
 *
 * - `sector`   — une feuille par rayon. Celle qu'on punaise au comptoir.
 * - `employee` — une feuille pour l'équipe, un salarié par ligne. Celle où
 *                chacun cherche son nom.
 * - `day`      — une feuille par journée choisie. Celle du matin même.
 */
export type PublicationLayout = "sector" | "employee" | "day"

export interface PublicationOptions {
  readonly layout: PublicationLayout
  /** Les rayons publiés. Un rayon absent d'ici ne paraît sur aucune feuille. */
  readonly sectorIds: readonly string[]
  /**
   * Les journées publiées par la mise en page « par jour ».
   *
   * Explicite, jamais « vide veut dire toutes » : une liste vide est un choix —
   * le gérant a tout décoché — et la feuille le dit au lieu de tout réimprimer.
   */
  readonly dates: readonly IsoDate[]
  /** Les totaux d'heures figurent-ils sur la feuille affichée ? */
  readonly showTotals: boolean
}

export const PUBLICATION_LAYOUTS: readonly {
  readonly layout: PublicationLayout
  readonly label: string
  readonly description: string
}[] = [
  {
    layout: "sector",
    label: "Par rayons",
    description: "Une feuille par rayon, à afficher à son comptoir.",
  },
  {
    layout: "employee",
    label: "Par employés",
    description: "Une feuille pour l’équipe, un salarié par ligne.",
  },
  {
    layout: "day",
    label: "Par jour",
    description: "Une feuille par journée choisie, rayon par rayon.",
  },
]

/**
 * Le point de départ du dialogue : ce que le gérant regarde déjà.
 *
 * Les rayons sont ceux de la sélection en cours — publier autre chose que ce
 * qui est à l'écran serait imprimer un planning que personne n'a relu. Les
 * journées sont toutes celles qui ouvrent : une journée fermée n'a rien à
 * afficher, et la proposer cocherait une feuille vide par défaut.
 */
export function defaultPublicationOptions(
  input: PlanningBoardInput,
  sectorIds: readonly string[]
): PublicationOptions {
  const publishable = sectorIds.filter((id) => input.sectors.some((sector) => sector.id === id))
  return {
    layout: "sector",
    sectorIds: publishable.length > 0 ? publishable : input.sectors.map((sector) => sector.id),
    dates: input.days.filter((day) => !day.closed).map((day) => day.date),
    showTotals: true,
  }
}

export function toggleDate(options: PublicationOptions, date: IsoDate): PublicationOptions {
  return { ...options, dates: toggle(options.dates, date) }
}

export function toggleSector(options: PublicationOptions, sectorId: string): PublicationOptions {
  return { ...options, sectorIds: toggle(options.sectorIds, sectorId) }
}

/**
 * Y a-t-il quelque chose à imprimer ?
 *
 * Sans rayon il n'y a pas de planning ; sans journée la mise en page « par
 * jour » n'a pas de feuille. Le dialogue s'appuie dessus pour éteindre son
 * bouton plutôt que d'ouvrir un aperçu blanc.
 */
export function hasSomethingToPublish(options: PublicationOptions): boolean {
  if (options.sectorIds.length === 0) return false
  return options.layout !== "day" || options.dates.length > 0
}

function toggle<T extends string>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value]
}
