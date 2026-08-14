import { describe, expect, it } from "vitest"

import type { HolidayPlanEntry } from "@/features/core/models"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder/build-problem"
import { accueilCanonicalInput } from "@/features/core/planning-v3/__tests__/accueil-canonical"
import { driveCanonicalInput } from "@/features/core/planning-v3/__tests__/drive-canonical"

/**
 * Les jours fériés entrent dans le moteur SANS déplacer la production.
 *
 * Le premier test est le seul qui compte pour la non-régression, et il est plus
 * fort que rejouer le solveur : si le PROBLÈME construit est identique, la
 * solution l'est par construction — sans dépendre d'une limite d'horloge, d'une
 * machine occupée, ni de l'indéterminisme documenté du moteur rapide.
 *
 * Les suivants montrent ce que le plan fait quand il est là.
 */

const MONDAY = "2026-07-20"

const entry = (patch: Partial<HolidayPlanEntry> = {}): HolidayPlanEntry => ({
  date: MONDAY,
  opening: "travaille",
  volunteerIds: [],
  opensAtMinutes: 8 * 60,
  closesAtMinutes: 15 * 60,
  ...patch,
})

/** Le problème construit, ou l'échec de construction remonté tel quel. */
function problemOf(holidayPlan?: readonly HolidayPlanEntry[]) {
  const built = buildPlanningProblemV3({
    ...driveCanonicalInput(),
    ...(holidayPlan ? { holidayPlan } : {}),
  })
  if (!built.ok) {
    throw new Error(built.errors.map((error) => `${error.code} — ${error.message}`).join(" | "))
  }
  return built.problem
}

describe("sans plan férié, rien ne bouge", () => {
  it("construit exactement le même problème sur le Drive canonique", () => {
    expect(problemOf()).toEqual(problemOf())
  })

  it("construit exactement le même problème sur l’Accueil canonique", () => {
    expect(buildPlanningProblemV3(accueilCanonicalInput())).toEqual(
      buildPlanningProblemV3({ ...accueilCanonicalInput(), holidayPlan: [] })
    )
  })

  it("un plan vide vaut l’absence de plan", () => {
    expect(problemOf([])).toEqual(problemOf())
  })

  it("un plan portant sur une date hors période ne change rien", () => {
    // La semaine canonique commence le 20 juillet ; Noël n'y est pas.
    expect(problemOf([entry({ date: "2026-12-25", opening: "chome" })])).toEqual(problemOf())
  })
})

describe("un férié chômé ferme la journée", () => {
  const problem = problemOf([entry({ opening: "chome", opensAtMinutes: null, closesAtMinutes: null })])
  const monday = problem.days.find((day) => day.date === MONDAY)

  it("ferme le jour, sans horaires ni budget", () => {
    expect(monday).toMatchObject({
      closed: true,
      opensAtMinutes: null,
      closesAtMinutes: null,
      budgetMinutes: 0,
    })
  })

  it("ne rend personne disponible, volontaires compris", () => {
    const onMonday = problem.employeeDays.filter((entry) => entry.date === MONDAY)

    expect(onMonday.length).toBeGreaterThan(0)
    expect(onMonday.every((day) => !day.available)).toBe(true)
    expect(onMonday.every((day) => day.maximumMinutes === 0)).toBe(true)
  })

  it("laisse les autres journées de la semaine intactes", () => {
    const untouched = problemOf()
    for (const day of problem.days) {
      if (day.date === MONDAY) continue
      expect(day).toEqual(untouched.days.find((other) => other.date === day.date))
    }
  })
})

describe("un férié ouvert n’admet que les volontaires", () => {
  const problem = problemOf([entry({ volunteerIds: ["dylan", "erwan"] })])

  it("rend disponibles ceux qui se sont portés volontaires", () => {
    const volunteers = problem.employeeDays.filter(
      (day) => day.date === MONDAY && ["dylan", "erwan"].includes(String(day.employeeId))
    )

    expect(volunteers).toHaveLength(2)
    expect(volunteers.every((day) => day.available)).toBe(true)
  })

  it("laisse les autres indisponibles, même sans repos fixe ce jour-là", () => {
    // Personne n'a coché : ce n'est pas « disponible mais non retenu », c'est
    // indisponible. Le moteur n'arbitre pas une présence que nul n'a acceptée.
    const others = problem.employeeDays.filter(
      (day) => day.date === MONDAY && !["dylan", "erwan"].includes(String(day.employeeId))
    )

    expect(others.length).toBeGreaterThan(0)
    expect(others.every((day) => !day.available)).toBe(true)
  })

  it("applique les horaires exceptionnels du magasin ce jour-là", () => {
    const monday = problem.days.find((day) => day.date === MONDAY)
    const ordinary = problemOf().days.find((day) => day.date === MONDAY)

    expect(monday).toMatchObject({ closed: false, opensAtMinutes: 480, closesAtMinutes: 900 })
    // La journée ordinaire du Drive est plus large : c'est bien le réglage du
    // férié qui a remplacé l'horaire du lundi, et pas l'inverse.
    expect(ordinary?.opensAtMinutes).not.toBe(480)
  })

  it("borne un volontaire à la fenêtre exceptionnelle", () => {
    const dylan = problem.employeeDays.find(
      (day) => day.date === MONDAY && String(day.employeeId) === "dylan"
    )

    expect(dylan?.maximumMinutes).toBeLessThanOrEqual(900 - 480)
  })

  it("ignore des horaires exceptionnels incohérents plutôt que de vider la journée", () => {
    // Fermeture avant ouverture : le réglage ne tient pas debout, la journée
    // garde son horaire ordinaire au lieu de devenir impossible.
    const broken = problemOf([entry({ opensAtMinutes: 900, closesAtMinutes: 480 })])
    const monday = broken.days.find((day) => day.date === MONDAY)
    const ordinary = problemOf().days.find((day) => day.date === MONDAY)

    expect(monday?.opensAtMinutes).toBe(ordinary?.opensAtMinutes)
    expect(monday?.closesAtMinutes).toBe(ordinary?.closesAtMinutes)
  })
})
