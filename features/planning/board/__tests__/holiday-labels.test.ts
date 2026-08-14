import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type {
  PlanningBoardInput,
  PlanningBoardSelection,
} from "@/features/planning/board/model/board-input"
import { buildPlanningBoard } from "@/features/planning/board/model/board-view-model"
import { DAY_CODES } from "@/features/planning/holidays/model/holiday-treatment"

/**
 * Ce qu'une journée fériée DIT, sur la grille comme au mur.
 *
 * La règle tenue par ce fichier tient en une phrase : aucun sigle n'atteint
 * l'écran. « HF » ne veut rien dire pour la personne qui cherche son nom sur un
 * planning affiché, et « DH » se confond avec « DF » au premier coup d'œil.
 */

const HOURS = [
  { day: "tuesday", closed: false, opensAt: "06:00", closesAt: "20:00" },
  { day: "wednesday", closed: false, opensAt: "06:00", closesAt: "20:00" },
] as const

const employee = (id: string, name: string, patch: Record<string, unknown> = {}) => ({
  id: id as unknown as EmployeeId,
  name,
  sectorIds: ["drive"],
  contractMinutes: 2100,
  rules: [],
  ...patch,
})

function input(patch: Partial<PlanningBoardInput> = {}): PlanningBoardInput {
  return {
    periodStart: "2026-07-14",
    periodEnd: "2026-07-15",
    sectors: [{ id: "drive", name: "Drive", color: "#2563eb", hours: HOURS }],
    employees: [
      employee("luca", "Luca Martin", { scheduleType: "variable" }),
      employee("nora", "Nora Petit", { scheduleType: "fixed" }),
      employee("sami", "Sami Roche", { scheduleType: "variable", student: true }),
      employee("elsa", "Elsa Nguyen", { forfaitJour: true }),
    ],
    days: [
      // Le 14 juillet 2026 tombe un mardi.
      { date: "2026-07-14", weekDay: "tuesday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
      { date: "2026-07-15", weekDay: "wednesday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
    ],
    shifts: [],
    demand: [],
    holidays: [
      {
        date: "2026-07-14",
        name: "Fête Nationale",
        opening: "travaille",
        volunteerIds: [],
      },
    ],
    storeOpensSundays: false,
    ...patch,
  }
}

const selection: PlanningBoardSelection = {
  view: "sector",
  sectorIds: ["drive"],
  date: "2026-07-14",
  employeeId: null,
}

const board = (patch: Partial<PlanningBoardInput> = {}) =>
  buildPlanningBoard(input(patch), selection)

describe("la grille nomme le férié et son traitement", () => {
  it("porte le nom du férié en tête de colonne", () => {
    const columns = board().sectorView.columns

    expect(columns.find((column) => column.date === "2026-07-14")?.holidayName).toBe(
      "Fête Nationale"
    )
    // Une journée ordinaire n'en porte aucun.
    expect(columns.find((column) => column.date === "2026-07-15")?.holidayName).toBeNull()
  })

  it("écrit le traitement en toutes lettres, jamais un sigle", () => {
    const labels = new Map(
      board().sectorView.rows.map((row) => [row.name, row.holidayLabelByDate["2026-07-14"]])
    )

    expect(labels.get("Luca Martin")).toBe("Jour férié")
    expect(labels.get("Nora Petit")).toBe("Férié non travaillé")
    // L'étudiant est traité comme un horaire fixe, sans qu'on l'ait ressaisi.
    expect(labels.get("Sami Roche")).toBe("Férié non travaillé")
    expect(labels.get("Elsa Nguyen")).toBe("Jour férié")
  })

  it("ne laisse aucun code brut atteindre la grille", () => {
    const rendered = JSON.stringify(board().sectorView)

    for (const code of DAY_CODES) {
      expect(rendered).not.toMatch(new RegExp(`"${code}"`))
    }
  })

  it("ne dit rien des journées qui ne sont pas fériées", () => {
    expect(board().sectorView.rows[0].holidayLabelByDate["2026-07-15"]).toBeUndefined()
  })
})

describe("le férié remplace « Repos », qui n’expliquait rien", () => {
  it("dit pourquoi la journée est vide dans la vue du jour", () => {
    const rows = board().dayView.rows
    const luca = rows.find((row) => row.name === "Luca Martin")

    expect(luca?.restLabel).toBe("Jour férié")
    expect(luca?.holidayLabel).toBe("Jour férié")
  })

  it("garde « Repos » sur une journée ordinaire", () => {
    const ordinary = buildPlanningBoard(input(), { ...selection, date: "2026-07-15" })

    expect(ordinary.dayView.rows[0].restLabel).toBe("Repos")
    expect(ordinary.dayView.rows[0].holidayLabel).toBeNull()
  })

  it("dit la même chose sur la fiche du salarié", () => {
    const employeeView = buildPlanningBoard(input(), {
      ...selection,
      view: "employee",
      employeeId: "nora" as unknown as EmployeeId,
    }).employeeView

    const tuesday = employeeView?.days.find((day) => day.date === "2026-07-14")
    expect(tuesday?.restLabel).toBe("Férié non travaillé")
  })
})

describe("un volontaire retenu n’est pas traité comme un absent", () => {
  it("ne porte aucun libellé quand il travaille effectivement", () => {
    const withShift = board({
      holidays: [
        { date: "2026-07-14", name: "Fête Nationale", opening: "travaille", volunteerIds: ["luca"] },
      ],
      shifts: [
        {
          id: "s1",
          employeeId: "luca" as unknown as EmployeeId,
          sectorId: "drive",
          date: "2026-07-14",
          startMinutes: 360,
          endMinutes: 840,
          workedMinutes: 480,
          segments: [{ startMinutes: 360, endMinutes: 840 }],
          opensDay: false,
          closesDay: false,
        },
      ],
    })

    const luca = withShift.sectorView.rows.find((row) => row.name === "Luca Martin")
    expect(luca?.holidayLabelByDate["2026-07-14"]).toBeUndefined()
    // Et celui qui n'est pas venu garde le sien.
    const nora = withShift.sectorView.rows.find((row) => row.name === "Nora Petit")
    expect(nora?.holidayLabelByDate["2026-07-14"]).toBe("Férié non travaillé")
  })
})

describe("sans fériés réglés, la grille est celle d’avant", () => {
  it("ne porte ni nom de férié ni libellé", () => {
    const plain = buildPlanningBoard(
      { ...input(), holidays: undefined, storeOpensSundays: undefined },
      selection
    )

    expect(plain.sectorView.columns.every((column) => column.holidayName === null)).toBe(true)
    expect(
      plain.sectorView.rows.every((row) => Object.keys(row.holidayLabelByDate).length === 0)
    ).toBe(true)
    expect(plain.dayView.rows[0].restLabel).toBe("Repos")
  })
})
