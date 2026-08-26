import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type { PlanningBoardInput } from "@/features/planning/board"
import {
  buildEmployeeDocument,
  type PublicationWeek,
} from "@/features/planning/publication/model/employee-document"
import { defaultPublicationOptions } from "@/features/planning/publication/model/publication-options"

/**
 * La feuille qu'on donne en main propre.
 *
 * Elle renverse la grille : les colonnes deviennent les jours de la semaine et
 * chaque LIGNE est une semaine. C'est ce renversement qui permet de voir qu'on
 * ferme trois vendredis de suite — ce que trois feuilles séparées ne montrent
 * jamais.
 */

const HOURS = [
  { day: "monday", closed: false, opensAt: "06:00", closesAt: "20:00" },
  { day: "tuesday", closed: false, opensAt: "06:00", closesAt: "20:00" },
] as const

const employee = (id: string, name: string) => ({
  id: id as unknown as EmployeeId,
  name,
  sectorIds: ["drive"],
  contractMinutes: 960,
  rules: [],
})

function weekInput(monday: string, tuesday: string, withShift: boolean): PlanningBoardInput {
  return {
    periodStart: monday,
    periodEnd: tuesday,
    sectors: [{ id: "drive", name: "Drive", color: "#2563eb", hours: HOURS }],
    employees: [employee("luca", "Luca Martin")],
    days: [
      { date: monday as never, weekDay: "monday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
      { date: tuesday as never, weekDay: "tuesday", closed: true, opensAtMinutes: null, closesAtMinutes: null },
    ],
    shifts: withShift
      ? [{
          id: `s_${monday}`,
          employeeId: "luca" as unknown as EmployeeId,
          sectorId: "drive",
          date: monday as never,
          startMinutes: 360,
          endMinutes: 840,
          workedMinutes: 480,
          segments: [{ startMinutes: 360, endMinutes: 840 }],
          opensDay: true,
          closesDay: false,
        }]
      : [],
    demand: [],
  }
}

const weeks: readonly PublicationWeek[] = [
  { weekStart: "2026-08-31" as never, label: "S36", input: weekInput("2026-08-31", "2026-09-01", true) },
  { weekStart: "2026-09-07" as never, label: "S37", input: weekInput("2026-09-07", "2026-09-08", false) },
]

const context = {
  storeName: "Test",
  storeCity: null,
  draft: false,
  printedAtLabel: "Édité",
  employeeNames: { luca: "Luca Martin", iris: "Iris Blanc" },
}

const options = (over: object = {}) => ({
  ...defaultPublicationOptions(weeks[0].input, ["drive"]),
  layout: "employee" as const,
  employeeIds: ["luca"],
  ...over,
})

describe("feuille par salarié", () => {
  it("sort une feuille par salarié, et une LIGNE par semaine", () => {
    const document = buildEmployeeDocument(weeks, options(), context)
    const [page] = document.pages

    expect(document.pages).toHaveLength(1)
    expect(page.title).toBe("Luca MARTIN")
    expect(page.kind).toBe("grid")
    if (page.kind !== "grid") return
    expect(page.rowHeaderLabel).toBe("Semaine")
    expect(page.rows.map((row) => row.name)).toEqual(["S36", "S37"])
  })

  /**
   * Une date en tête de colonne serait celle d'UNE des semaines empilées, donc
   * fausse pour toutes les autres. Le jour de la semaine, lui, est vrai partout.
   */
  it("ne met aucune date en tête de colonne, seulement le jour", () => {
    const [page] = buildEmployeeDocument(weeks, options(), context).pages
    if (page.kind !== "grid") return

    expect(page.columns.map((column) => column.dayLabel)).toEqual([
      "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
    ])
    expect(page.columns.every((column) => column.dateLabel === "")).toBe(true)
  })

  it("range les semaines dans l'ordre du temps et porte les heures de chacune", () => {
    const [page] = buildEmployeeDocument(weeks, options(), context).pages
    if (page.kind !== "grid") return

    // S36 : une vacation le lundi. S37 : rien, mais la ligne existe.
    expect(page.rows[0].cells[0].slots.map((slot) => slot.label)).toEqual(["06:00 – 14:00"])
    expect(page.rows[0].totalLabel).toBe("8h")
    expect(page.rows[1].cells[0].slots).toEqual([])
    expect(page.rows[1].totalLabel).toBe("0h")
  })

  /** La pause voyage avec la durée, ici comme sur les feuilles de rayon. */
  it("écrit la pause derrière la durée", () => {
    const [page] = buildEmployeeDocument(weeks, options(), context).pages
    if (page.kind !== "grid") return

    expect(page.rows[0].cells[0].slots[0].durationLabel).toBe("8h (24 min)")
  })

  /**
   * Additionner le lundi de trois semaines différentes ne répond à aucune
   * question : le pied des totaux n'a pas de sens sur cette feuille.
   */
  it("ne totalise pas les jours entre semaines", () => {
    const [page] = buildEmployeeDocument(weeks, options(), context).pages
    if (page.kind !== "grid") return

    expect(page.totals).toBeNull()
  })

  it("marque la journée fermée, et le jour absent de la période", () => {
    const [page] = buildEmployeeDocument(weeks, options(), context).pages
    if (page.kind !== "grid") return

    // Mardi est fermé dans la période ; mercredi n'en fait pas partie du tout.
    expect(page.rows[0].cells[1].emptyLabel).toBe("Fermé")
    expect(page.rows[0].cells[2].emptyLabel).toBe("—")
  })

  it("ne montre RIEN tant qu'aucun salarié n'est choisi", () => {
    const document = buildEmployeeDocument(weeks, options({ employeeIds: [] }), context)

    expect(document.pages).toEqual([])
    expect(document.emptyLabel).toBe("Choisissez au moins un salarié à afficher.")
  })

  /**
   * Quelqu'un peut n'apparaître dans AUCUN planning des semaines demandées —
   * hors périmètre généré, ou en congé tout le mois. Sa feuille disparaissait
   * alors en silence, et l'écran lui répondait « choisissez un salarié » alors
   * qu'il venait d'en choisir un. Elle sort, vide, et c'est la réponse.
   */
  it("sort quand même la feuille de qui n'est planifié nulle part", () => {
    const [page] = buildEmployeeDocument(weeks, options({ employeeIds: ["iris"] }), context).pages

    expect(page.title).toBe("Iris BLANC")
    if (page.kind !== "grid") return
    expect(page.rows).toHaveLength(2)
    expect(page.rows.every((row) => row.cells.every((cell) => cell.slots.length === 0))).toBe(true)
  })
})
