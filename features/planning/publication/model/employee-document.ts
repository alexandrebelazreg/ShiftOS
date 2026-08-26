import { WEEK_DAYS, type IsoDate } from "@/features/core/models"
import { buildPlanningBoard, type PlanningBoardInput } from "@/features/planning/board"
import { nameWithUppercaseFamily, WEEK_DAY_LABELS } from "@/features/planning/board/model/labels"
import type {
  PublicationCellVM,
  PublicationColumnVM,
  PublicationContext,
  PublicationDocumentVM,
  PublicationGridPageVM,
  PublicationRowVM,
} from "@/features/planning/publication/model/publication-document"
import { slotsOfShift } from "@/features/planning/publication/model/publication-document"
import type { PublicationOptions } from "@/features/planning/publication/model/publication-options"

/**
 * Une semaine affichable, telle que l'écran la propose.
 *
 * Elle porte l'entrée du board DÉJÀ RÉUNIE : le Drive et la zone marché d'une
 * même semaine s'y sont rejoints en amont, sans quoi la feuille d'un salarié
 * qui touche aux deux n'en montrerait qu'une moitié.
 */
export interface PublicationWeek {
  readonly weekStart: IsoDate
  /** « S36 · 31/08 → 06/09 » — ce qu'une ligne porte en tête. */
  readonly label: string
  readonly input: PlanningBoardInput
}

/**
 * La feuille d'un salarié, sur autant de semaines qu'on en demande.
 *
 * Elle renverse la grille : les colonnes deviennent les JOURS DE LA SEMAINE —
 * lundi, mardi… sans date, puisqu'elles changent d'une ligne à l'autre — et
 * chaque ligne est une semaine. Trois semaines empilées se comparent alors
 * d'un coup d'œil : on voit qu'on ferme trois vendredis de suite, ce que trois
 * feuilles séparées ne montrent jamais.
 *
 * ELLE NE MONTRE RIEN PAR DÉFAUT, et c'est voulu : sans salarié choisi, la
 * feuille est vide et le dit. Imprimer toute l'équipe sur trois semaines par
 * simple inertie ferait sortir vingt pages que personne n'a demandées.
 *
 * Les rayons ne sont pas filtrés ici. Une feuille personnelle doit dire TOUTES
 * les heures de la personne : masquer un rayon lui cacherait une journée où
 * elle est pourtant attendue.
 */
export function buildEmployeeDocument(
  weeks: readonly PublicationWeek[],
  options: PublicationOptions,
  context: PublicationContext
): PublicationDocumentVM {
  const boards = weeks.map((week) => ({
    week,
    board: buildPlanningBoard(week.input, {
      view: "sector",
      sectorIds: week.input.sectors.map((sector) => sector.id),
      date: null,
      employeeId: null,
    }),
  }))

  // Les colonnes ne portent QUE le nom du jour. Une date en tête serait celle
  // d'une seule des semaines empilées, donc fausse pour toutes les autres.
  const columns: PublicationColumnVM[] = WEEK_DAYS.map((weekDay) => ({
    date: weekDay as unknown as IsoDate,
    dayLabel: WEEK_DAY_LABELS[weekDay],
    dateLabel: "",
    closed: false,
    holidayName: null,
  }))

  const pages: PublicationGridPageVM[] = options.employeeIds.flatMap((employeeId) => {
    /**
     * Le nom vient de la FICHE d'abord, du planning ensuite.
     *
     * Quelqu'un peut n'apparaître dans aucun planning des semaines demandées —
     * hors périmètre généré, ou en congé tout le mois. Sa feuille disparaissait
     * alors en silence alors qu'on venait de le cocher, et l'écran répondait
     * « choisissez au moins un salarié » à quelqu'un qui venait d'en choisir un.
     * Elle sort désormais, vide, et c'est la bonne réponse : il n'est attendu
     * nulle part cette semaine-là.
     */
    const fromBoard = boards
      .map(({ board }) => board.sectorView.rows.find((row) => String(row.employeeId) === employeeId))
      .find((row) => row !== undefined)
    const name = context.employeeNames?.[employeeId] ?? fromBoard?.name
    if (!name) return []

    const rows: PublicationRowVM[] = boards.map(({ week, board }) => {
      const row = board.sectorView.rows.find((entry) => String(entry.employeeId) === employeeId)
      const dayByWeekDay = new Map(week.input.days.map((day) => [day.weekDay, day]))

      const cells: PublicationCellVM[] = WEEK_DAYS.map((weekDay) => {
        const day = dayByWeekDay.get(weekDay)
        // La semaine ne porte pas ce jour : le planning couvre six jours et
        // la colonne existe pour les sept. Ce n'est pas « fermé », c'est
        // « hors période » — et un tiret le dit sans rien affirmer de plus.
        if (!day) {
          return { date: `${week.weekStart}_${weekDay}` as unknown as IsoDate, emptyLabel: "—", holiday: false, slots: [] }
        }
        const shifts = row?.shiftsByDate[day.date] ?? []
        const holiday = row?.holidayLabelByDate[day.date] ?? null
        return {
          date: day.date,
          emptyLabel: day.closed
            ? "Fermé"
            : shifts.length === 0
              ? holiday ?? "Repos"
              : null,
          holiday: holiday !== null && shifts.length === 0 && !day.closed,
          // Tous les rayons se nomment : une feuille personnelle mélange les
          // comptoirs, et deux cases côte à côte ne diraient plus laquelle est
          // laquelle.
          slots: shifts.flatMap((shift) => slotsOfShift(shift, true, null)),
        }
      })

      return {
        key: `${employeeId}_${week.weekStart}`,
        name: week.label,
        initials: "",
        cells,
        totalLabel: options.showTotals ? row?.plannedLabel ?? "0h" : null,
      }
    })

    return [{
      kind: "grid" as const,
      key: `employee_${employeeId}`,
      title: nameWithUppercaseFamily(name),
      subtitle: weeks.length > 1 ? `${weeks.length} semaines` : null,
      rowHeaderLabel: "Semaine",
      columns,
      rows,
      // Un total par jour n'a pas de sens ici : additionner le lundi de trois
      // semaines différentes ne répond à aucune question.
      totals: null,
      emptyLabel: null,
    }]
  })

  return {
    title: "Planning par salarié",
    storeLabel: context.storeName,
    storeSubLabel: context.storeCity,
    weekLabel: weeks.length === 1 ? weeks[0].label : `${weeks.length} semaines`,
    rangeLabel: weeks.length === 0 ? "" : `${weeks[0].label} → ${weeks[weeks.length - 1].label}`,
    draftLabel: null,
    printedAtLabel: context.printedAtLabel,
    pages,
    emptyLabel:
      weeks.length === 0
        ? "Aucune semaine choisie."
        : options.employeeIds.length === 0
          ? "Choisissez au moins un salarié à afficher."
          : pages.length === 0
            // Distinct du cas précédent, et le message doit le dire : répondre
            // « choisissez un salarié » à quelqu'un qui vient d'en cocher un le
            // laisse chercher ce qu'il a mal fait.
            ? "Aucun de ces salariés n’est connu de l’application."
            : null,
  }
}
