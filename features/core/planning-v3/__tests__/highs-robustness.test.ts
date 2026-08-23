import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

/**
 * The perturbation campaign, audited by the OFFICIAL validator.
 *
 * The three canonical scenarios say the engine answers three problems. They say
 * nothing about how it behaves one step away, and a heuristic that is excellent
 * on its development case and brittle beside it is worse than a slow engine that
 * degrades predictably — because the brittleness stays invisible until a real
 * roster meets it.
 *
 * So the Python campaign walks out from Drive along six axes and this file asks
 * the only questions that matter about each answer, using the one implementation
 * that decides what "legal" means in Planiteo:
 *
 * - a schedule, if there is one, breaks no hard rule;
 * - `infeasible-proven` is never said about a week that arithmetic says is
 *   staffable — that claim tells a manager their shop cannot open;
 * - no proof is claimed, at any budget;
 * - nothing crashed.
 *
 * The campaign is NOT wired into the application, and these tests SKIP when its
 * artefacts are absent, so a clone that has never run Python stays green:
 *
 *     experiments/planning-v3-highs> python perturbations.py --time-limit 60
 */

const ROOT = join(process.cwd(), "experiments", "planning-v3-highs")
const FIXTURES = join(ROOT, "fixtures", "perturbations")
const RESULTS = join(ROOT, "results", "perturbations")

interface CampaignEntry {
  readonly id: string
  readonly axis: string
  readonly description: string
  /** What arithmetic said BEFORE the solver ran. Never the solver's own word. */
  readonly expected: "feasible" | "impossible"
  readonly coherence: readonly string[]
  readonly status: string
  readonly seconds: number
  readonly referenceShortSlots: number | null
  readonly referenceDeficitMinutes: number | null
  readonly proof: string | null
  readonly crash: string | null
}

interface Campaign {
  readonly timeLimitSeconds: number
  readonly scenarios: readonly CampaignEntry[]
}

interface SolverResult {
  readonly status: string
  readonly solution: PlanningSolutionV3 | null
  readonly diagnostics: Record<string, unknown>
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null
}

const campaign = readJson<Campaign>(join(RESULTS, "summary.json"))
const entries = campaign?.scenarios ?? []

/** Statuses the fast engine may return while carrying a schedule. */
const STATUSES_WITH_SOLUTION = ["feasible-zero-deficit", "feasible-best-effort"]

describe("HiGHS rapide — campagne de perturbations", () => {
  it.skipIf(campaign === null)("couvre les six axes demandés", () => {
    const axes = new Set(entries.map((entry) => entry.axis))
    expect([...axes].sort()).toEqual([
      "absences",
      "budgets",
      "coupures",
      "demande",
      "heure-de-debut",
      "repos-fixes",
    ])
    expect(entries.length).toBeGreaterThanOrEqual(40)
  })

  it.skipIf(campaign === null)("respecte le budget de soixante secondes", () => {
    expect(campaign!.timeLimitSeconds).toBeLessThanOrEqual(60)
  })

  it.skipIf(campaign === null)("n'a planté sur aucun scénario", () => {
    const crashed = entries.filter((entry) => entry.crash !== null)
    expect(crashed.map((entry) => `${entry.id}: ${entry.crash}`)).toEqual([])
  })

  it.skipIf(campaign === null)("ne revendique jamais de preuve sur un planning", () => {
    // Deux choix heuristiques précèdent la seule étape exacte. Aucun budget ne
    // rend un PLANNING démontrable, et le prétendre serait pire que le manque.
    //
    // Une IMPOSSIBILITÉ est le cas inverse : le modèle de demande et le MILP
    // d'allocation prouvent chacun la leur, et `structural` ou `solver` est le
    // mot juste. Exiger `none` partout pousserait le moteur à taire une preuve
    // qu'il détient réellement.
    const claiming = entries.filter(
      (entry) =>
        STATUSES_WITH_SOLUTION.includes(entry.status) &&
        entry.proof !== null &&
        entry.proof !== "none"
    )
    expect(claiming.map((entry) => `${entry.id}: ${entry.proof}`)).toEqual([])
  })

  it.skipIf(campaign === null)("prouve les impossibilités au lieu de renoncer", () => {
    // Un `timeout-without-solution` sur une semaine arithmétiquement impossible
    // n'est pas faux, seulement muet : le moteur brûle son budget pour dire
    // qu'il n'a rien trouvé là où le MILP d'allocation le démontre en une
    // seconde. Un responsable mérite « le contrat de Luca ne tient pas dans ses
    // jours restants », pas « le moteur a renoncé ».
    const silent = entries.filter(
      (entry) => entry.expected === "impossible" && entry.status === "timeout-without-solution"
    )
    expect(silent.map((entry) => `${entry.id} — ${entry.coherence.join(" ; ")}`)).toEqual([])
  })

  it.skipIf(campaign === null)(
    "ne déclare jamais infaisable une semaine que l'arithmétique dit tenable",
    () => {
      // Le faux diagnostic est la faute la plus coûteuse de ce moteur : il dit à
      // un responsable que son magasin ne peut pas ouvrir. Les conditions
      // testées côté Python sont NÉCESSAIRES, donc une semaine qui les passe
      // peut encore être impossible pour une raison plus fine — mais alors
      // l'ingénieur doit le prouver, pas le solveur l'affirmer.
      const suspects = entries.filter(
        (entry) => entry.expected === "feasible" && entry.status === "infeasible-proven"
      )
      expect(suspects.map((entry) => `${entry.id} — ${entry.description}`)).toEqual([])
    }
  )

  it.skipIf(campaign === null)(
    "ne fabrique jamais un planning pour une semaine arithmétiquement impossible",
    () => {
      const invented = entries.filter(
        (entry) => entry.expected === "impossible" && STATUSES_WITH_SOLUTION.includes(entry.status)
      )
      expect(
        invented.map((entry) => `${entry.id} — ${entry.coherence.join(" ; ")}`)
      ).toEqual([])
    }
  )
})

/**
 * Every schedule the campaign produced, re-checked one by one.
 *
 * A Python answer is never accepted on its own word: `shiftos_highs.evaluate` is
 * a second implementation of the rules and a second implementation can be wrong
 * in the same way as the first.
 */
describe("HiGHS rapide — légalité de chaque planning perturbé", () => {
  const cases = entries.filter((entry) => STATUSES_WITH_SOLUTION.includes(entry.status))

  it.skipIf(campaign === null)("a produit au moins un planning à auditer", () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const entry of cases) {
    const problem = readJson<PlanningProblemV3>(join(FIXTURES, `${entry.id}-problem.json`))
    const result = readJson<SolverResult>(join(RESULTS, `${entry.id}-fast.json`))
    const missing = problem === null || result === null || result.solution === null

    it.skipIf(missing)(`${entry.id} — aucune violation dure`, () => {
      const report = validatePlanningSolutionV3(problem!, result!.solution!)
      expect(report.violations).toEqual([])
      expect(report.validHardConstraints).toBe(true)
    })

    it.skipIf(missing)(`${entry.id} — plancher incassable tenu`, () => {
      const report = validatePlanningSolutionV3(problem!, result!.solution!)
      // Une violation de plancher est bloquante, jamais une dégradation.
      expect(report.violations.some((violation) => violation.rule === "hard-coverage-floor")).toBe(
        false
      )
    })

    it.skipIf(missing)(`${entry.id} — contrats et budgets exacts`, () => {
      const report = validatePlanningSolutionV3(problem!, result!.solution!)
      const weekKey = problem!.days[0].weekKey
      for (const employee of problem!.employees) {
        expect(
          report.metrics.weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`]
        ).toBe(employee.contractMinutes)
      }
      for (const day of problem!.days.filter((candidate) => !candidate.closed)) {
        expect(report.metrics.dailyMinutesByDate[day.date]).toBe(day.budgetMinutes)
      }
    })

    it.skipIf(missing)(`${entry.id} — ne planifie aucun salarié indisponible`, () => {
      const unavailable = new Set(
        problem!.employeeDays
          .filter((candidate) => !candidate.available)
          .map((candidate) => `${String(candidate.employeeId)}|${candidate.date}`)
      )
      for (const assignment of result!.solution!.assignments) {
        expect(unavailable.has(`${String(assignment.employeeId)}|${assignment.date}`)).toBe(false)
      }
    })

    it.skipIf(missing)(`${entry.id} — le manque annoncé est le manque réel`, () => {
      // Le moteur rapporte son propre déficit. Ce chiffre décide de ce qu'un
      // responsable voit et corrige : il doit venir du validateur officiel, pas
      // du modèle qui l'a produit.
      const report = validatePlanningSolutionV3(problem!, result!.solution!)
      expect(report.underCoveredSlots).toBe(entry.referenceShortSlots)
      expect(report.metrics.totalDeficitMinutes).toBe(entry.referenceDeficitMinutes)
    })
  }
})
