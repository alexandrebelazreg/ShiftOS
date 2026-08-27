import { describe, expect, it } from "vitest"

import { buildHolidayVolunteerMatrix } from "@/features/planning/holidays/model/holiday-volunteer-matrix"
import {
  buildHolidayYear,
  holidayDatesOf,
} from "@/features/planning/holidays/model/holiday-year-view-model"

/**
 * Qui accepte quel férié, toute l'année d'un coup.
 *
 * Le volontariat se recueillait jour par jour, onze listes dépliables. On
 * pouvait donc régler l'année entière sans jamais voir que la même personne
 * avait dit oui à tout et une autre à rien. Ce que cette matrice ajoute n'est
 * pas une commodité d'affichage — c'est la seule lecture qui répond à « qui
 * porte les fériés de cette maison ».
 */

const employees = [
  { id: "jessica", name: "Jessica Barq", active: true },
  { id: "daniel", name: "Daniel Dumange", active: true },
  { id: "parti", name: "Ancien Salarié", active: false },
]

const OPEN = { opensAt: "08:30", closesAt: "20:00" }
const PAQUES = "2026-04-06"
const VICTOIRE = "2026-05-08"

function year(stored: Record<string, unknown>) {
  return buildHolidayYear({
    year: 2026,
    stored: stored as never,
    employees,
    usualHours: () => OPEN,
  })
}

/**
 * Les huit fériés ouverts par défaut, ramenés à deux.
 *
 * Le défaut ne dépend PAS des horaires du magasin — `defaultHolidaySchedules`
 * propose « travaillé » pour tout ce qui n'est pas dans sa liste de chômés — et
 * une fixture qui l'ignorait aurait paru fausse alors qu'elle mesurait le vrai
 * comportement. On ferme donc explicitement tout le reste.
 */
function onlyOpen(dates: readonly string[], stored: Record<string, unknown> = {}) {
  const closed = Object.fromEntries(
    holidayDatesOf(2026)
      .filter((date) => !dates.includes(date))
      .map((date) => [date, { opening: "chome" }])
  )
  return { ...closed, ...stored }
}

describe("matrice des volontaires", () => {
  const stored = onlyOpen([PAQUES, VICTOIRE], {
    [PAQUES]: { opening: "travaille", ...OPEN, volunteerIds: ["jessica"] },
    [VICTOIRE]: { opening: "demi-chome", ...OPEN, volunteerIds: ["jessica", "daniel"] },
  })

  it("ne donne une colonne qu'aux fériés ouverts", () => {
    const matrix = buildHolidayVolunteerMatrix(year(stored))

    // Un jour chômé n'a personne à recruter : une colonne vide inviterait à y
    // cocher quelqu'un, et ce clic ne pourrait rien vouloir dire.
    expect(matrix.columns.map((column) => column.date)).toEqual([PAQUES, VICTOIRE])
    expect(matrix.columns.map((column) => column.openingLabel)).toEqual(["travaillé", "½ jour"])
  })

  it("abrège la date pour qu'elle tienne en tête de colonne", () => {
    expect(buildHolidayVolunteerMatrix(year(stored)).columns[0].shortLabel).toBe("6 avr")
  })

  it("coche qui est volontaire, et laisse les autres vides", () => {
    const matrix = buildHolidayVolunteerMatrix(year(stored))
    const jessica = matrix.rows.find((row) => row.name.startsWith("Jessica"))
    const daniel = matrix.rows.find((row) => row.name.startsWith("Daniel"))

    expect(jessica?.cells.map((cell) => cell.volunteer)).toEqual([true, true])
    expect(daniel?.cells.map((cell) => cell.volunteer)).toEqual([false, true])
  })

  /**
   * La colonne qui n'existait nulle part : combien de fériés chacun accepte.
   * C'est la même question que l'équité des fermetures.
   */
  it("totalise par personne, ce qui était impossible à lire avant", () => {
    const matrix = buildHolidayVolunteerMatrix(year(stored))

    expect(matrix.rows.find((row) => row.name.startsWith("Jessica"))?.total).toBe(2)
    expect(matrix.rows.find((row) => row.name.startsWith("Daniel"))?.total).toBe(1)
  })

  it("totalise par jour, ce que le pied de tableau annonce", () => {
    const matrix = buildHolidayVolunteerMatrix(year(stored))

    expect(matrix.columns.map((column) => column.volunteerCount)).toEqual([1, 2])
  })

  /** Un salarié désactivé n'est plus là : le proposer serait recruter un absent. */
  it("ignore les salariés désactivés", () => {
    const matrix = buildHolidayVolunteerMatrix(year(stored))

    expect([...matrix.rows.map((row) => row.employeeId)].sort()).toEqual(["daniel", "jessica"])
  })

  it("se déclare vide quand aucun férié n'est ouvert", () => {
    const matrix = buildHolidayVolunteerMatrix(year(onlyOpen([])))

    expect(matrix.empty).toBe(true)
    expect(matrix.rows).toEqual([])
    expect(matrix.columns).toEqual([])
  })
})
