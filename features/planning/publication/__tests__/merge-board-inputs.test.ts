import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type { PlanningBoardInput } from "@/features/planning/board"
import { mergeBoardInputs } from "@/features/planning/publication/model/merge-board-inputs"

/**
 * Réunir le Drive et la zone marché d'une même semaine.
 *
 * Ce qui se vérifie ici n'est pas la concaténation — elle est triviale — mais
 * les trois endroits où mettre bout à bout donne une réponse FAUSSE : les
 * identifiants qui se marchent dessus, la journée fermée d'un côté et ouverte
 * de l'autre, et l'objectif de rayon qui n'a plus de sens une fois les
 * périmètres réunis.
 */

const employee = (id: string, sectorIds: readonly string[], extra: object = {}) => ({
  id: id as unknown as EmployeeId,
  name: id,
  sectorIds: [...sectorIds],
  contractMinutes: 36 * 60 + 45,
  rules: [],
  ...extra,
})

const shift = (id: string, employeeId: string, sectorId: string) => ({
  id,
  employeeId: employeeId as unknown as EmployeeId,
  sectorId,
  date: "2026-09-07" as const,
  startMinutes: 360,
  endMinutes: 840,
  workedMinutes: 480,
  segments: [{ startMinutes: 360, endMinutes: 840 }],
  opensDay: false,
  closesDay: false,
})

const week = (over: Partial<PlanningBoardInput>): PlanningBoardInput => ({
  periodStart: "2026-09-07",
  periodEnd: "2026-09-13",
  sectors: [],
  employees: [],
  days: [],
  shifts: [],
  demand: [],
  ...over,
})

describe("mergeBoardInputs", () => {
  it("ne fabrique rien quand il n'y a rien", () => {
    expect(mergeBoardInputs([])).toBeNull()
  })

  it("rend l'entrée telle quelle quand elle est seule", () => {
    const only = week({ sectors: [{ id: "drive", name: "Drive" }] })
    expect(mergeBoardInputs([only])).toBe(only)
  })

  it("réunit les rayons et les vacations des deux plannings", () => {
    const merged = mergeBoardInputs([
      week({
        sectors: [{ id: "drive", name: "Drive" }],
        employees: [employee("luca", ["drive"])],
        shifts: [shift("s1", "luca", "drive")],
      }),
      week({
        sectors: [{ id: "poisson", name: "Poisson" }],
        employees: [employee("luca", ["poisson"])],
        shifts: [shift("s1", "luca", "poisson")],
      }),
    ])!

    expect(merged.sectors.map((sector) => sector.id)).toEqual(["drive", "poisson"])
    expect(merged.shifts).toHaveLength(2)
  })

  /**
   * Le défaut le plus sournois : rien ne garantit que deux générations
   * distinctes nomment leurs vacations différemment. Deux identifiants égaux
   * se seraient écrasés dans les clés de rendu, et une journée aurait disparu
   * de la feuille sans une erreur.
   */
  it("sépare deux vacations qui portaient le même identifiant", () => {
    const merged = mergeBoardInputs([
      week({ shifts: [shift("meme-id", "luca", "drive")] }),
      week({ shifts: [shift("meme-id", "luca", "poisson")] }),
    ])!

    expect(new Set(merged.shifts.map((entry) => entry.id)).size).toBe(2)
  })

  it("réunit les rayons d'un salarié présent des deux côtés", () => {
    const merged = mergeBoardInputs([
      week({ employees: [employee("luca", ["drive"])] }),
      week({ employees: [employee("luca", ["poisson", "drive"])] }),
    ])!

    expect(merged.employees).toHaveLength(1)
    expect([...merged.employees[0].sectorIds].sort()).toEqual(["drive", "poisson"])
  })

  /** Une colonne barrée là où quelqu'un travaille est un mensonge. */
  it("n'appelle une journée fermée que si elle l'est des deux côtés", () => {
    const dimancheFerme = { date: "2026-09-13" as const, weekDay: "sunday" as const, closed: true, opensAtMinutes: null, closesAtMinutes: null }
    const dimancheOuvert = { date: "2026-09-13" as const, weekDay: "sunday" as const, closed: false, opensAtMinutes: 480, closesAtMinutes: 720 }

    expect(mergeBoardInputs([week({ days: [dimancheFerme] }), week({ days: [dimancheOuvert] })])!.days[0].closed).toBe(false)
    expect(mergeBoardInputs([week({ days: [dimancheOuvert] }), week({ days: [dimancheFerme] })])!.days[0].closed).toBe(false)
    expect(mergeBoardInputs([week({ days: [dimancheFerme] }), week({ days: [dimancheFerme] })])!.days[0].closed).toBe(true)
  })

  /**
   * `weeklyTargetMinutes` était la part d'un salarié DANS UN PÉRIMÈTRE. Les
   * périmètres réunis n'ont plus de part commune : garder celle du premier
   * ferait comparer un total de semaine à un objectif de rayon, et la feuille
   * annoncerait un dépassement là où le contrat est exactement tenu.
   */
  it("abandonne l'objectif de rayon, qui n'a plus de sens réuni", () => {
    const merged = mergeBoardInputs([
      week({ employees: [employee("luca", ["drive"], { weeklyTargetMinutes: 8 * 60 })] }),
      week({ employees: [employee("dylan", ["poisson"], { weeklyTargetMinutes: 4 * 60 })] }),
    ])!

    for (const entry of merged.employees) {
      expect(entry.weeklyTargetMinutes).toBeUndefined()
    }
  })

  it("garde les jours triés, quel que soit l'ordre des plannings", () => {
    const day = (date: string, weekDay: "monday" | "tuesday") => ({ date: date as never, weekDay, closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 })
    const merged = mergeBoardInputs([
      week({ days: [day("2026-09-08", "tuesday")] }),
      week({ days: [day("2026-09-07", "monday")] }),
    ])!

    expect(merged.days.map((entry) => entry.date)).toEqual(["2026-09-07", "2026-09-08"])
  })
})
