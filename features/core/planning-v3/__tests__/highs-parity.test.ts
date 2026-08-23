import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { buildDriveCanonicalProblem } from "@/features/core/planning-v3/__tests__/drive-canonical"
import { buildAccueilCanonicalProblem } from "@/features/core/planning-v3/__tests__/accueil-canonical"
import { buildDriveWithAbsencesProblem } from "@/features/core/planning-v3/__tests__/drive-absences"

/**
 * The Python/HiGHS experiment, audited by the OFFICIAL validator.
 *
 * The point of this file is that a Python answer is never accepted on its own
 * word. `shiftos_highs.evaluate` is a second implementation of the rules, and a
 * second implementation can be wrong in the same way as the first — so the
 * schedule is re-checked here, by the one implementation that decides what
 * "legal" means in Planiteo.
 *
 * The experiment is NOT wired into the application. These tests read artefacts
 * the solver writes under `experiments/planning-v3-highs/results/` and SKIP when
 * they are absent, so a clone that has never run Python stays green. Regenerate
 * with:
 *
 *     experiments/planning-v3-highs> python solve.py fixtures/drive-canonical-problem.json \
 *         --output results/drive-regression-1.json --time-limit 400
 */

const RESULTS = join(process.cwd(), "experiments", "planning-v3-highs", "results")

interface SolverResult {
  readonly status: string
  readonly problemFingerprint: string
  readonly solutionFingerprint?: string
  readonly solution: PlanningSolutionV3 | null
  readonly evaluation?: {
    readonly validHardConstraints: boolean
    readonly underCoveredSlots: number
    readonly totalDeficitMinutes: number
  }
  readonly diagnostics: Record<string, unknown>
}

function read(name: string): SolverResult | null {
  const path = join(RESULTS, name)
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SolverResult) : null
}

/** Statuses that carry a schedule. Every other one carries none. */
const STATUSES_WITH_SOLUTION = ["optimal", "feasible-time-limit"]

describe("HiGHS — régression Drive canonique", () => {
  const result = read("scenario-drive-canonical.json") ?? read("drive-regression-1.json")

  it.skipIf(result === null)("répond au problème canonique, pas à un autre", () => {
    const problem = buildDriveCanonicalProblem()
    expect(result!.problemFingerprint).toBe(fingerprintProblem(problem))
  })

  it.skipIf(result === null)("annonce un statut porteur de solution", () => {
    expect(STATUSES_WITH_SOLUTION).toContain(result!.status)
    expect(result!.solution).not.toBeNull()
  })

  it.skipIf(result === null)("est accepté par le validateur officiel", () => {
    const problem = buildDriveCanonicalProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)

    expect(report.violations).toEqual([])
    expect(report.validHardConstraints).toBe(true)
  })

  it.skipIf(result === null)("atteint zéro déficit et zéro créneau sous-couvert", () => {
    const problem = buildDriveCanonicalProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)

    expect(report.underCoveredSlots).toBe(0)
    expect(report.metrics.totalDeficitMinutes).toBe(0)
  })

  it.skipIf(result === null)("place les contrats et les budgets exactement", () => {
    const problem = buildDriveCanonicalProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)
    const weekKey = problem.days[0].weekKey

    for (const employee of problem.employees) {
      expect(
        report.metrics.weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`]
      ).toBe(employee.contractMinutes)
    }
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      expect(report.metrics.dailyMinutesByDate[day.date]).toBe(day.budgetMinutes)
    }
  })

  it.skipIf(result === null)("tient le plancher incassable sur chaque créneau", () => {
    const problem = buildDriveCanonicalProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)

    // La règle que la fixture déclare désormais explicitement. Une violation
    // ici serait bloquante, jamais une dégradation.
    expect(report.violations.some((entry) => entry.rule === "hard-coverage-floor")).toBe(false)
    expect(problem.demandSlots.every((slot) => slot.hardMinimumEmployees === 1)).toBe(true)
  })
})

/**
 * Accueil — unequal contracts, half-hour opening, two floors of different
 * heights, and one contract that only fits as a split.
 */
describe("HiGHS — Accueil canonique", () => {
  const result = read("scenario-accueil-canonical.json")

  it.skipIf(result === null)("répond au bon problème et porte une solution", () => {
    const problem = buildAccueilCanonicalProblem()
    expect(result!.problemFingerprint).toBe(fingerprintProblem(problem))
    expect(STATUSES_WITH_SOLUTION).toContain(result!.status)
  })

  it.skipIf(result === null)("est accepté par le validateur officiel", () => {
    const problem = buildAccueilCanonicalProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)
    expect(report.violations).toEqual([])
    expect(report.validHardConstraints).toBe(true)
  })

  it.skipIf(result === null)("tient les deux planchers, dont les deux du samedi", () => {
    const problem = buildAccueilCanonicalProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)
    expect(report.violations.some((entry) => entry.rule === "hard-coverage-floor")).toBe(false)
  })

  it.skipIf(result === null)("place les contrats et les budgets exactement", () => {
    const problem = buildAccueilCanonicalProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)
    const weekKey = problem.days[0].weekKey
    for (const employee of problem.employees) {
      expect(
        report.metrics.weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`]
      ).toBe(employee.contractMinutes)
    }
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      expect(report.metrics.dailyMinutesByDate[day.date]).toBe(day.budgetMinutes)
    }
  })
})

/**
 * Drive with two employees away all week.
 *
 * The point is what does NOT happen: the engine must not answer "impossible"
 * because the normal demand became unreachable. A reduced team gets a legal
 * schedule with a measured shortfall.
 */
describe("HiGHS — Drive avec effectif réduit", () => {
  const result = read("scenario-drive-absences.json")

  it.skipIf(result === null)("ne déclare PAS le problème infaisable", () => {
    expect(result!.status).not.toBe("infeasible-proven")
    expect(STATUSES_WITH_SOLUTION).toContain(result!.status)
    expect(result!.solution).not.toBeNull()
  })

  it.skipIf(result === null)("produit un planning légal", () => {
    const problem = buildDriveWithAbsencesProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)
    expect(report.violations).toEqual([])
    expect(report.validHardConstraints).toBe(true)
  })

  it.skipIf(result === null)("maintient la présence continue malgré la réduction", () => {
    const problem = buildDriveWithAbsencesProblem()
    const report = validatePlanningSolutionV3(problem, result!.solution!)
    // Le plancher dur ne se négocie pas, même à effectif réduit.
    expect(report.violations.some((entry) => entry.rule === "hard-coverage-floor")).toBe(false)
  })

  it.skipIf(result === null)("ne planifie jamais un salarié absent", () => {
    const problem = buildDriveWithAbsencesProblem()
    const unavailable = new Set(
      problem.employeeDays
        .filter((entry) => !entry.available)
        .map((entry) => `${String(entry.employeeId)}|${entry.date}`)
    )
    for (const assignment of result!.solution!.assignments) {
      expect(unavailable.has(`${String(assignment.employeeId)}|${assignment.date}`)).toBe(false)
    }
  })
})

/**
 * `v3-highs-fast` — the decomposed engine, audited by the same authority.
 *
 * It is NOT held to the oracle's numbers here: it trades the optimality proof
 * for speed, and the gap is a measurement, not a defect. What it IS held to is
 * legality — a fast answer that breaks a rule is worth nothing — and to never
 * claiming a proof it does not have.
 */
const FAST_STATUSES_WITH_SOLUTION = ["feasible-zero-deficit", "feasible-best-effort"]

describe("HiGHS rapide — les trois scénarios", () => {
  const scenarios = [
    ["fast-drive-canonical.json", buildDriveCanonicalProblem],
    ["fast-accueil-canonical.json", buildAccueilCanonicalProblem],
    ["fast-drive-absences.json", buildDriveWithAbsencesProblem],
  ] as const

  for (const [file, build] of scenarios) {
    const result = read(file)

    it.skipIf(result === null)(`${file} répond au bon problème`, () => {
      expect(result!.problemFingerprint).toBe(fingerprintProblem(build()))
      expect(FAST_STATUSES_WITH_SOLUTION).toContain(result!.status)
      expect(result!.solution).not.toBeNull()
    })

    it.skipIf(result === null)(`${file} est accepté par le validateur officiel`, () => {
      const report = validatePlanningSolutionV3(build(), result!.solution!)
      expect(report.violations).toEqual([])
      expect(report.validHardConstraints).toBe(true)
    })

    it.skipIf(result === null)(`${file} tient le plancher incassable`, () => {
      const report = validatePlanningSolutionV3(build(), result!.solution!)
      expect(report.violations.some((entry) => entry.rule === "hard-coverage-floor")).toBe(false)
    })

    it.skipIf(result === null)(`${file} place contrats et budgets exactement`, () => {
      const problem = build()
      const report = validatePlanningSolutionV3(problem, result!.solution!)
      const weekKey = problem.days[0].weekKey
      for (const employee of problem.employees) {
        expect(
          report.metrics.weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`]
        ).toBe(employee.contractMinutes)
      }
      for (const day of problem.days.filter((entry) => !entry.closed)) {
        expect(report.metrics.dailyMinutesByDate[day.date]).toBe(day.budgetMinutes)
      }
    })

    it.skipIf(result === null)(`${file} ne revendique aucune optimalité`, () => {
      // Deux choix heuristiques — allocation et squelette — précèdent la seule
      // étape exacte. Aucun budget ne rend cette réponse démontrable.
      expect(result!.diagnostics.proof).toBe("none")
    })
  }
})

/**
 * The three coverage-semantics cases, audited by the same authority.
 *
 * The distinction they pin is the one the parity milestone got wrong: a target
 * that cannot be met is a DEGRADATION, and only an unreachable floor is an
 * impossibility.
 */
describe("HiGHS — sémantique de couverture", () => {
  const caseA = read("semantics-case-a.json")
  const caseB = read("semantics-case-b.json")
  const caseC = read("semantics-case-c.json")

  it.skipIf(caseA === null)("cas A — cible atteignable : aucun manque", () => {
    expect(STATUSES_WITH_SOLUTION).toContain(caseA!.status)
    expect(caseA!.evaluation?.underCoveredSlots).toBe(0)
    expect(caseA!.evaluation?.totalDeficitMinutes).toBe(0)
    expect(caseA!.evaluation?.validHardConstraints).toBe(true)
  })

  it.skipIf(caseB === null)(
    "cas B — cible impossible mais plancher tenu : légal, avec un manque mesuré",
    () => {
      // Le point non négociable : PAS `infeasible`.
      expect(caseB!.status).not.toBe("infeasible-proven")
      expect(STATUSES_WITH_SOLUTION).toContain(caseB!.status)
      expect(caseB!.solution).not.toBeNull()

      // Un planning légal…
      expect(caseB!.evaluation?.validHardConstraints).toBe(true)
      // …dont le manque est explicite et chiffré.
      expect(caseB!.evaluation?.underCoveredSlots).toBeGreaterThan(0)
      expect(caseB!.evaluation?.totalDeficitMinutes).toBeGreaterThan(0)
    }
  )

  it.skipIf(caseC === null)("cas C — plancher impossible : infaisable, sans faux planning", () => {
    expect(caseC!.status).toBe("infeasible-proven")
    expect(caseC!.solution).toBeNull()
    // Surtout : aucune solution dégradée présentée comme un résultat.
    expect(caseC!.evaluation).toBeUndefined()
  })
})
