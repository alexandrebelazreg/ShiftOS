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
  /** Jours de fermeture inscrits sur la fiche. */
  readonly mustClose?: readonly string[]
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
        mustClose: (person.mustClose ?? []).includes(date),
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
  it("s'applique sur la configuration du magasin", () => {
    // Sans cette assertion, tout ce qui suit se vérifierait sur un plan vide :
    // `quotas` serait `[]`, les sommes vaudraient zéro, et les tests
    // passeraient en ne prouvant rien. C'est le piège dans lequel deux tests
    // sont déjà tombés au cours de cette enquête.
    const plan = planClosingQuotas(problemOf(STORE))
    expect(plan.applied, plan.reason ?? "").toBe(true)
    expect(plan.reason).toBeNull()
  })

  it("laisse au moteur PLUS de fermetures possibles qu'il n'en faut", () => {
    // Le quota pose des BORNES, il ne prescrit pas une répartition. Prescrire un
    // nombre exact à chacun revenait à choisir une seule des répartitions
    // équitables, et faisait une capacité égale au strict besoin : le moindre
    // conflit un jour donné condamnait alors la semaine entière, et tout le
    // plafond était rejeté. Il faut de la marge pour que le moteur cherche.
    const plan = planClosingQuotas(problemOf(STORE))
    const total = plan.quotas.reduce((sum, quota) => sum + quota.allowed, 0)
    expect(total).toBeGreaterThan(DAYS.length)
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

  it("n'exclut personne : au moins une fermeture pour qui peut fermer", () => {
    // La répartition purement équitable donnait ZÉRO au plus chargé. C'est juste
    // arithmétiquement et intenable en pratique : l'exclure laisse des journées
    // sans fermeur, la semaine devient infaisable, et le plafond entier est
    // rejeté au profit des plafonds ordinaires — mesuré sur le magasin réel,
    // « aucun planning légal ne respectait ces plafonds ». Un quota rejeté ne
    // vaut rien ; mieux vaut resserrer moins et que cela tienne.
    const given = allowed(planClosingQuotas(problemOf(STORE)))
    for (const [id, value] of Object.entries(given)) {
      expect(value, `${id} exclu de toute fermeture`).toBeGreaterThanOrEqual(1)
    }
    // Et les plus chargés descendent quand même de deux à une.
    expect(given.dylan).toBe(1)
    expect(given.arthur).toBe(1)
  })

  it("ne plafonne pas sous les fermetures IMPOSÉES par la fiche", () => {
    // Dylan ferme obligatoirement le vendredi et le samedi. Le plafonner à une
    // ne changerait rien à ce qu'il fera — il en assurera deux de toute façon —
    // et rendrait seulement la semaine infaisable. Le quota doit reconnaître
    // ce qui est déjà décidé avant de répartir ce qui reste.
    const withDuty: readonly Person[] = STORE.map((person) =>
      person.id === "dylan"
        ? { ...person, mustClose: ["2026-09-11", "2026-09-12"] }
        : person
    )
    const plan = planClosingQuotas(problemOf(withDuty))
    expect(plan.applied, plan.reason ?? "").toBe(true)
    expect(allowed(plan).dylan).toBeGreaterThanOrEqual(2)
  })

  it("refuse quand les fermetures imposées dépassent déjà la semaine", () => {
    // Sept fermetures inscrites sur les fiches pour six jours ouverts : le
    // réglage est contradictoire, et fabriquer un quota par-dessus ne ferait
    // qu'ajouter une infaisabilité. C'est au validateur de le dire, pas ici.
    const tooMany: readonly Person[] = STORE.map((person, index) => ({
      ...person,
      cap: null,
      mustClose: index < 4 ? DAYS.slice(0, 2) : DAYS.slice(0, 1),
    }))
    const plan = planClosingQuotas(problemOf(tooMany))
    expect(plan.applied).toBe(false)
    expect(plan.reason).toContain("imposées")
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

  it("ne resserre pas toute l'équipe parce qu'un nouveau n'a jamais fermé", () => {
    // Le repère est la charge MOYENNE. S'il était la plus légère, l'arrivée
    // d'un salarié sans historique classerait d'un coup tous les autres parmi
    // les « trop servis » — y compris ceux qui ferment déjà le moins.
    const withNewcomer: readonly Person[] = [
      ...STORE,
      { id: "nouveau", cap: 2, workingDays: 6, past: 0 },
    ]
    const given = allowed(planClosingQuotas(problemOf(withNewcomer)))
    // Les chargés sont retenus…
    expect(given.dylan).toBe(1)
    expect(given.arthur).toBe(1)
    // …et les autres gardent leur plafond de fiche.
    expect(given.valentin).toBe(2)
    expect(given.erwan).toBe(2)
    expect(given.nouveau).toBe(2)
  })
})
