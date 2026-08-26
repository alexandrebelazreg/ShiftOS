import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import {
  emptyBoardInput,
  type PlanningBoardInput,
} from "@/features/planning/board/model/board-input"
import { buildPlanningBoard } from "@/features/planning/board/model/board-view-model"
import { PlanningBoard } from "@/features/planning/board/ui/PlanningBoard"

/**
 * La barre de commande ne dépend pas de l'existence d'un planning.
 *
 * Tomber sur une semaine vide faisait disparaître la barre entière — flèches de
 * semaine comprises — au profit d'un autre en-tête portant une liste déroulante.
 * Autrement dit : le moyen de revenir en arrière changeait de forme et de place
 * au moment précis où l'on en avait besoin. Ce que ces tests tiennent, c'est
 * que les MÊMES commandes soient là des deux côtés de la frontière.
 */

const noop = () => undefined

function board(input: PlanningBoardInput | null, week: string) {
  return renderToStaticMarkup(
    <PlanningBoard
      input={input}
      selectedWeek={week}
      sectorIds={["drive"]}
      sectorChoices={[
        { id: "drive", name: "Drive", selected: true },
        { id: "caisse", name: "Caisse", selected: false },
      ]}
      onToggleSector={noop}
      onToggleAllSectors={noop}
    />
  )
}

function weekWithPlanning(): PlanningBoardInput {
  return {
    periodStart: "2026-08-31",
    periodEnd: "2026-09-06",
    sectors: [{ id: "drive", name: "Drive" }],
    employees: [
      {
        id: "luca" as unknown as EmployeeId,
        name: "Luca Drive",
        sectorIds: ["drive"],
        contractMinutes: 480,
        rules: [],
      },
    ],
    days: [
      { date: "2026-08-31", weekDay: "monday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
    ],
    shifts: [
      {
        id: "shift_1",
        employeeId: "luca" as unknown as EmployeeId,
        sectorId: "drive",
        date: "2026-08-31",
        startMinutes: 360,
        endMinutes: 840,
        workedMinutes: 480,
        segments: [{ startMinutes: 360, endMinutes: 840 }],
        opensDay: true,
        closesDay: false,
      },
    ],
    demand: [],
  }
}

describe("semaine sans planning — les commandes restent", () => {
  it("garde les deux flèches de semaine", () => {
    const html = board(null, "2026-09-14")
    expect(html).toContain('aria-label="Semaine précédente"')
    expect(html).toContain('aria-label="Semaine suivante"')
  })

  it("garde le saut direct à une semaine", () => {
    expect(board(null, "2026-09-14")).toContain('aria-label="Semaine affichée"')
  })

  it("garde le choix du rayon, qui est ce qu'on règle AVANT de générer", () => {
    const html = board(null, "2026-09-14")
    expect(html).toContain("Secteur :")
    // Le menu résume la sélection : c'est bien le rayon choisi qu'il annonce.
    expect(html).toContain(">Drive<")
  })

  it("annonce la semaine regardée, pas une autre", () => {
    const html = board(null, "2026-09-14")
    expect(html).toContain("Semaine 38")
    expect(html).toContain("Aucun planning généré pour la semaine 38.")
  })

  it("propose de générer cette semaine-là", () => {
    expect(board(null, "2026-09-14")).toContain("Générer cette semaine")
  })

  /**
   * Le cœur du défaut : la barre était la même des deux côtés, sauf qu'elle
   * n'existait que d'un seul.
   */
  it("offre exactement les mêmes commandes qu'une semaine remplie", () => {
    const empty = board(null, "2026-09-14")
    const filled = board(weekWithPlanning(), "2026-08-31")
    for (const control of [
      'aria-label="Semaine précédente"',
      'aria-label="Semaine suivante"',
      'aria-label="Semaine affichée"',
      "Secteur :",
    ]) {
      expect(empty).toContain(control)
      expect(filled).toContain(control)
    }
  })

  it("montre l'état vide plutôt qu'une grille sous un mauvais en-tête", () => {
    // Un planning chargé mais d'une AUTRE semaine que celle affichée.
    const html = board(weekWithPlanning(), "2026-09-14")
    expect(html).toContain("Aucun planning généré pour la semaine 38.")
    expect(html).not.toContain("Luca Drive")
  })
})

describe("emptyBoardInput", () => {
  it("couvre la semaine ISO du lundi demandé, et n'invente rien d'autre", () => {
    const input = emptyBoardInput("2026-09-16")
    expect(input.periodStart).toBe("2026-09-14")
    expect(input.periodEnd).toBe("2026-09-20")
    expect(input.employees).toEqual([])
    expect(input.shifts).toEqual([])
    expect(input.days).toEqual([])
    expect(input.demand).toEqual([])
  })

  it("traverse le ViewModel sans rien casser", () => {
    const vm = buildPlanningBoard(emptyBoardInput("2026-09-14"), {
      view: "sector",
      sectorIds: ["drive"],
      date: null,
      employeeId: null,
    })
    expect(vm.toolbar.weekNumber).toBe(38)
    expect(vm.toolbar.canGoPreviousWeek).toBe(true)
    expect(vm.toolbar.canGoNextWeek).toBe(true)
    expect(vm.sectorView.rows).toEqual([])
    expect(vm.summary.deficits).toEqual([])
  })
})
