import { describe, expect, it } from "vitest"

import { planClosingQuotas } from "@/features/core/planning-v3/fairness/closing-quota"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { EmployeeId, IsoDate } from "@/features/core/models"

/**
 * Le plafond de fermetures que l'équité impose.
 *
 * La forme testée est celle d'un vrai magasin, relevée sur son problème
 * exporté : cinq salariés au même contrat, six jours d'ouverture, une
 * fermeture par jour, deux salariés très chargés et un plafonné à une seule
 * fermeture. C'est la configuration où toutes les tentatives précédentes ont
 * échoué — préférence noyée sous la couverture, puis rééquilibrage bloqué par
 * les bornes horaires.
 */

const DAYS = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"]
const CLOSES = 1200

interface Person {
  readonly id: string
  readonly cap: number | null
  readonly workingDays: number
  readonly past: number
  readonly off?: readonly string[]
}

function problemOf(team: readonly Person[], fairness = true): PlanningProblemV3 {
  return {
    version: 3,
    rules: {
      exactClosingsPerDay: 1,
      closingFairness: fairness
        ? { balanceClosings: true, balanceSaturdayClosings: false, lookbackWeeks: 8 }
        : null,
    },
    days: DAYS.map((date) => ({
      date: date as IsoDate,
      closed: false,
      closesAtMinutes: CLOSES,
    })),
    employees: team.map((person) => ({
      id: person.id as unknown as EmployeeId,
      canClose: true,
      maximumClosings: person.cap,
      workingDays: Array.from({ length: person.workingDays }, (_, index) => index),
    })),
    employeeDays: DAYS.flatMap((date) =>
      team.map((person) => ({
        employeeId: person.id as unknown as EmployeeId,
        date: date as IsoDate,
        available: !(person.off ?? []).includes(date),
        latestEndMinutes: CLOSES,
      }))
    ),
    closingHistory: team.map((person) => ({
      employeeId: person.id as unknown as EmployeeId,
      closings: person.past,
      opportunities: 15,
      saturdayClosings: 0,
      saturdayOpportunities: 15,
    })),
  } as unknown as PlanningProblemV3
}

/** Le magasin réel : deux chargés, trois légers, Luca plafonné à une. */
const STORE: readonly Person[] = [
  { id: "dylan", cap: 2, workingDays: 6, past: 6 },
  { id: "arthur", cap: 2, workingDays: 5, past: 6, off: ["2026-09-10"] },
  { id: "valentin", cap: 2, workingDays: 6, past: 2 },
  { id: "luca", cap: 1, workingDays: 5, past: 2, off: ["2026-09-09"] },
  { id: "erwan", cap: 2, workingDays: 6, past: 2 },
]

const allowed = (plan: ReturnType<typeof planClosingQuotas>) =>
  Object.fromEntries(plan.quotas.map((quota) => [String(quota.employeeId), quota.allowed]))

describe("plafond d'équité", () => {
  it("distribue toutes les fermetures de la semaine, ni plus ni moins", () => {
    // En dessous, la semaine devient infaisable ; au-dessus, on autorise ce que
    // personne n'a demandé. Le total est la seule valeur juste.
    const plan = planClosingQuotas(problemOf(STORE))
    const total = plan.quotas.reduce((sum, quota) => sum + quota.allowed, 0)
    expect(total).toBe(DAYS.length)
  })

  it("donne moins à ceux qui ont déjà le plus fermé", () => {
    const plan = planClosingQuotas(problemOf(STORE))
    const given = allowed(plan)
    const heavy = given.dylan + given.arthur
    const light = given.valentin + given.luca + given.erwan
    expect(heavy).toBeLessThan(light)
    // La promesse du gérant, littéralement : les deux qui ferment toujours
    // cessent de tout prendre.
    expect(heavy).toBeLessThanOrEqual(2)
  })

  it("ne dépasse JAMAIS le plafond réglé sur la fiche", () => {
    // Il resserre, il n'autorise pas. Un quota au-dessus du plafond de fiche
    // ferait faire au moteur ce que le gérant a explicitement interdit.
    const plan = planClosingQuotas(problemOf(STORE))
    for (const quota of plan.quotas) {
      if (quota.contractual !== null) expect(quota.allowed).toBeLessThanOrEqual(quota.contractual)
    }
    expect(allowed(plan).luca).toBeLessThanOrEqual(1)
  })

  it("laisse le problème intact quand l'équité est éteinte", () => {
    const problem = problemOf(STORE, false)
    const plan = planClosingQuotas(problem)
    expect(plan.applied).toBe(false)
    expect(plan.problem).toBe(problem)
  })

  it("ne resserre rien quand la capacité suffit à peine", () => {
    // Six fermetures pour deux personnes plafonnées à trois : tout le monde est
    // déjà au maximum de ce qu'il peut porter. Resserrer rendrait la semaine
    // infaisable, donc on ne touche à rien et on laisse le moteur faire au mieux.
    const tight: readonly Person[] = [
      { id: "a", cap: 3, workingDays: 6, past: 6 },
      { id: "b", cap: 3, workingDays: 6, past: 0 },
    ]
    const problem = problemOf(tight)
    expect(planClosingQuotas(problem).problem).toBe(problem)
  })

  it("n'attribue rien à qui ne peut fermer aucun jour", () => {
    // Indisponible toute la semaine : lui donner un quota gèlerait des
    // fermetures que personne ne pourrait prendre.
    const withGhost: readonly Person[] = [
      ...STORE,
      { id: "fantome", cap: 2, workingDays: 6, past: 0, off: DAYS },
    ]
    expect(allowed(planClosingQuotas(problemOf(withGhost))).fantome).toBe(0)
  })
})
