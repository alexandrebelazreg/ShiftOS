import type { IsoDate } from "@/features/core/models"
import { MONTH_LABELS } from "@/features/planning/board/model/labels"
import type { HolidayYearVM } from "@/features/planning/holidays/model/holiday-year-view-model"

/**
 * Qui est volontaire, quel jour — toute l'année d'un coup.
 *
 * Le volontariat se recueillait JOUR PAR JOUR, chaque férié dépliant sa propre
 * liste de vingt-quatre cases. Deux questions restaient alors sans réponse à
 * l'écran, et ce sont justement celles qu'on se pose : qui accepte souvent, et
 * qui n'accepte jamais. Il fallait déplier onze listes et retenir.
 *
 * La matrice les répond en les MONTRANT : une ligne par salarié, une colonne
 * par férié ouvert, un total en bout de ligne. C'est la même question que
 * l'équité des fermetures, et elle n'avait jusqu'ici aucune lecture.
 *
 * Les jours CHÔMÉS n'ont pas de colonne. Non pas pour gagner de la place, mais
 * parce qu'ils n'ont personne à recruter : une colonne vide inviterait à y
 * cocher quelqu'un, et ce clic ne pourrait rien vouloir dire.
 */

export interface HolidayMatrixColumnVM {
  readonly date: IsoDate
  /** « 6 avr » — assez court pour tenir en tête de colonne. */
  readonly shortLabel: string
  /** « travaillé » ou « ½ jour », sous la date. */
  readonly openingLabel: string
  readonly volunteerCount: number
}

export interface HolidayMatrixCellVM {
  readonly date: IsoDate
  readonly volunteer: boolean
}

export interface HolidayMatrixRowVM {
  readonly employeeId: string
  readonly name: string
  readonly cells: readonly HolidayMatrixCellVM[]
  /** Sur combien de fériés ouverts cette personne se porte volontaire. */
  readonly total: number
}

export interface HolidayVolunteerMatrixVM {
  readonly columns: readonly HolidayMatrixColumnVM[]
  readonly rows: readonly HolidayMatrixRowVM[]
  /** Vrai quand aucun férié n'est ouvert : il n'y a alors rien à recueillir. */
  readonly empty: boolean
}

const SHORT_MONTHS = [
  "janv", "févr", "mars", "avr", "mai", "juin",
  "juil", "août", "sept", "oct", "nov", "déc",
]

export function buildHolidayVolunteerMatrix(year: HolidayYearVM): HolidayVolunteerMatrixVM {
  const open = year.days.filter((day) => day.acceptsVolunteers)

  const columns: HolidayMatrixColumnVM[] = open.map((day) => ({
    date: day.date,
    shortLabel: shortDateLabel(day.date),
    openingLabel: day.opening === "demi-chome" ? "½ jour" : "travaillé",
    volunteerCount: day.volunteers.filter((volunteer) => volunteer.volunteer).length,
  }))

  /**
   * L'équipe vient du PREMIER jour ouvert, pas d'une union.
   *
   * Chaque jour porte le même effectif — les salariés actifs — donc n'importe
   * lequel suffit, et prendre le premier garde l'ordre dans lequel le modèle
   * les a rangés. Réunir les onze listes aurait produit le même résultat pour
   * un coût, et un ordre dépendant du premier jour où chacun apparaît.
   */
  const roster = open[0]?.volunteers ?? []
  const volunteersByDate = new Map(
    open.map((day) => [
      day.date,
      new Set(day.volunteers.filter((entry) => entry.volunteer).map((entry) => entry.employeeId)),
    ])
  )

  const rows: HolidayMatrixRowVM[] = roster.map((employee) => {
    const cells = columns.map((column) => ({
      date: column.date,
      volunteer: volunteersByDate.get(column.date)?.has(employee.employeeId) ?? false,
    }))
    return {
      employeeId: employee.employeeId,
      name: employee.name,
      cells,
      total: cells.filter((cell) => cell.volunteer).length,
    }
  })

  return { columns, rows, empty: columns.length === 0 }
}

/** « 6 avr » — la date sans le jour de la semaine, qui ne tiendrait pas. */
function shortDateLabel(date: IsoDate): string {
  const [, month, day] = date.split("-")
  return `${Number(day)} ${SHORT_MONTHS[Number(month) - 1] ?? MONTH_LABELS[Number(month) - 1]}`
}
