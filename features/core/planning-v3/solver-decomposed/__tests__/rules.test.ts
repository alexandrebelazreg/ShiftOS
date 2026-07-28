import { describe, expect, it } from "vitest"

import { solveDecomposed } from "@/features/core/planning-v3/solver-decomposed"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { minutesOf, tinyProblem } from "@/features/core/planning-v3/solver-decomposed/__tests__/tiny"

/**
 * The rules, one test each, on problems small enough that a failure points at a
 * single line.
 *
 * Every legality claim is checked against the INDEPENDENT validator wherever
 * the validator knows the rule. Where it does not — the split floor, the
 * continuous-stretch cap — the test measures the returned segments directly,
 * because asserting that the engine agrees with itself would prove nothing.
 */

const FAST = { timeoutMs: 10_000, maximumPlacementNodes: 500_000 } as const

describe("Phase 2 — allocation des minutes", () => {
  it("place le contrat hebdomadaire exactement, ni plus ni moins", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 900 }],
      days: [{ budgetMinutes: 480 }, { budgetMinutes: 420 }],
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.solution).not.toBeNull()
    expect(minutesOf(run.result.solution!, "a")).toBe(900)
  })

  it("respecte le budget journalier exactement sur chaque jour", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 720 }, { id: "b", contractMinutes: 720 }],
      days: [{ budgetMinutes: 720 }, { budgetMinutes: 720 }],
    })
    const run = solveDecomposed(problem, FAST)
    const report = validatePlanningSolutionV3(problem, run.result.solution!)

    for (const day of problem.days) {
      expect(report.metrics.dailyMinutesByDate[day.date]).toBe(day.budgetMinutes)
    }
  })

  it("redistribue sur les jours disponibles quand un jour ne l'est pas", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 900 }],
      days: [{ budgetMinutes: 0 }, { budgetMinutes: 450 }, { budgetMinutes: 450 }],
      unavailable: ["a|0"],
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.solution).not.toBeNull()
    expect(minutesOf(run.result.solution!, "a")).toBe(900)
    // Rien le jour indisponible : l'absence de candidat exprime la règle,
    // aucune correction a posteriori n'est nécessaire.
    expect(
      run.result.solution!.assignments.some((assignment) => assignment.date === problem.days[0].date)
    ).toBe(false)
  })

  it("pose toutes les durées sur le pas de 15 minutes", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 555 }],
      days: [{ budgetMinutes: 555 }],
    })
    const run = solveDecomposed(problem, FAST)

    for (const assignment of run.result.solution!.assignments) {
      for (const segment of assignment.segments) {
        expect(segment.startMinutes % 15).toBe(0)
        expect(segment.endMinutes % 15).toBe(0)
      }
    }
  })
})

describe("Phase 4 — bornes de durée", () => {
  it("ne produit jamais un segment sous la durée minimale", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 480 }, { id: "b", contractMinutes: 480 }],
      days: [{ budgetMinutes: 480 }, { budgetMinutes: 480 }],
      rules: { minimumShiftMinutes: 240 },
    })
    const run = solveDecomposed(problem, FAST)

    for (const assignment of run.result.solution!.assignments) {
      for (const segment of assignment.segments) {
        expect(segment.endMinutes - segment.startMinutes).toBeGreaterThanOrEqual(240)
      }
    }
  })

  it("ne dépasse jamais la durée quotidienne maximale", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 1_020 }],
      days: [{ budgetMinutes: 540 }, { budgetMinutes: 480 }],
      rules: { maximumShiftMinutes: 600 },
    })
    const run = solveDecomposed(problem, FAST)
    const report = validatePlanningSolutionV3(problem, run.result.solution!)

    expect(report.violations.some((v) => v.rule === "maximum-shift")).toBe(false)
    for (const assignment of run.result.solution!.assignments) {
      const minutes = assignment.segments.reduce(
        (sum, segment) => sum + (segment.endMinutes - segment.startMinutes),
        0
      )
      expect(minutes).toBeLessThanOrEqual(600)
    }
  })

  it("refuse une journée de 10 h en un seul bloc quand le continu est plafonné à 8 h", () => {
    // Sans coupure autorisée, 600 minutes ne rentrent pas dans un continu de
    // 480 : le moteur ne doit PAS produire un bloc illégal, il doit renoncer.
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 600 }],
      days: [{ budgetMinutes: 600 }],
      rules: { maximumContinuousMinutes: 480, splitShiftAllowed: false },
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.solution).toBeNull()
    expect(run.result.proof.kind).toBe("none")
  })

  it("accepte une journée de 10 h en coupure quand la coupure est autorisée", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 600, canSplitShift: true }],
      days: [{ budgetMinutes: 600, opensAtMinutes: 360, closesAtMinutes: 1_320 }],
      rules: {
        maximumContinuousMinutes: 480,
        splitShiftAllowed: true,
        minimumSplitMinutes: 45,
        maximumSplitMinutes: 90,
      },
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.solution).not.toBeNull()
    const assignment = run.result.solution!.assignments[0]
    expect(assignment.segments).toHaveLength(2)
    expect(minutesOf(run.result.solution!, "a")).toBe(600)
    for (const segment of assignment.segments) {
      const duration = segment.endMinutes - segment.startMinutes
      expect(duration).toBeGreaterThanOrEqual(240)
      expect(duration).toBeLessThanOrEqual(480)
    }
  })

  it("tient la coupure entre 45 et 90 minutes", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 600, canSplitShift: true }],
      days: [{ budgetMinutes: 600, opensAtMinutes: 360, closesAtMinutes: 1_320 }],
      rules: {
        maximumContinuousMinutes: 480,
        splitShiftAllowed: true,
        minimumSplitMinutes: 45,
        maximumSplitMinutes: 90,
      },
    })
    const run = solveDecomposed(problem, FAST)
    const segments = run.result.solution!.assignments[0].segments

    const gap = segments[1].startMinutes - segments[0].endMinutes
    expect(gap).toBeGreaterThanOrEqual(45)
    expect(gap).toBeLessThanOrEqual(90)
  })
})

describe("contraintes horaires individuelles", () => {
  it("ne commence jamais avant l'heure de départ au plus tôt", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 480 }, { id: "b", contractMinutes: 480 }],
      days: [{ budgetMinutes: 960 }],
      windows: { "a|0": { earliest: 600 } },
    })
    const run = solveDecomposed(problem, FAST)
    const report = validatePlanningSolutionV3(problem, run.result.solution!)

    expect(report.violations.some((v) => v.rule === "availability")).toBe(false)
    for (const assignment of run.result.solution!.assignments) {
      if (String(assignment.employeeId) !== "a") continue
      expect(assignment.segments[0].startMinutes).toBeGreaterThanOrEqual(600)
    }
  })

  it("ne finit jamais après l'heure de fin au plus tard", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 480 }, { id: "b", contractMinutes: 480 }],
      days: [{ budgetMinutes: 960 }],
      windows: { "a|0": { latest: 900 } },
    })
    const run = solveDecomposed(problem, FAST)

    for (const assignment of run.result.solution!.assignments) {
      if (String(assignment.employeeId) !== "a") continue
      const last = assignment.segments[assignment.segments.length - 1]
      expect(last.endMinutes).toBeLessThanOrEqual(900)
    }
  })
})

describe("ouvertures, fermetures et repos", () => {
  it("ne dépasse jamais le maximum d'ouvertures d'un salarié", () => {
    const problem = tinyProblem({
      employees: [
        { id: "a", contractMinutes: 720, maximumOpenings: 1 },
        { id: "b", contractMinutes: 720 },
      ],
      days: [{ budgetMinutes: 480 }, { budgetMinutes: 480 }, { budgetMinutes: 480 }],
      rules: { minimumOpeningsPerDay: 1, exactClosingsPerDay: 0 },
    })
    const run = solveDecomposed(problem, FAST)
    const report = validatePlanningSolutionV3(problem, run.result.solution!)

    expect(report.violations.some((v) => v.rule === "maximum-openings")).toBe(false)
    expect(report.metrics.openingsByEmployee["a"] ?? 0).toBeLessThanOrEqual(1)
  })

  it("ne dépasse jamais le maximum de fermetures d'un salarié", () => {
    const problem = tinyProblem({
      employees: [
        { id: "a", contractMinutes: 720, maximumClosings: 1 },
        { id: "b", contractMinutes: 720 },
      ],
      days: [{ budgetMinutes: 480 }, { budgetMinutes: 480 }, { budgetMinutes: 480 }],
      rules: { minimumOpeningsPerDay: 0, exactClosingsPerDay: 1 },
    })
    const run = solveDecomposed(problem, FAST)
    const report = validatePlanningSolutionV3(problem, run.result.solution!)

    expect(report.violations.some((v) => v.rule === "maximum-closings")).toBe(false)
    expect(report.metrics.closingsByEmployee["a"] ?? 0).toBeLessThanOrEqual(1)
  })

  it("tient le repos interjournalier entre deux jours travaillés consécutifs", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 960 }, { id: "b", contractMinutes: 960 }],
      days: [{ budgetMinutes: 960 }, { budgetMinutes: 960 }],
      rules: { minimumRestMinutes: 720, exactClosingsPerDay: 1, minimumOpeningsPerDay: 1 },
    })
    const run = solveDecomposed(problem, FAST)
    const report = validatePlanningSolutionV3(problem, run.result.solution!)

    expect(report.violations.some((v) => v.rule === "minimum-rest")).toBe(false)
  })
})

describe("couverture", () => {
  it("compte la présence concurrente, pas le recouvrement par un seul shift", () => {
    // Deux shifts décalés couvrent ensemble 10:00–14:00 sans qu'aucun ne
    // l'englobe seul. Un moteur qui testerait le recouvrement par shift
    // déclarerait ce créneau à découvert.
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 300 }, { id: "b", contractMinutes: 300 }],
      days: [{ budgetMinutes: 600, opensAtMinutes: 480, closesAtMinutes: 1_080 }],
      slots: [{ startMinutes: 600, endMinutes: 840, requiredEmployees: 1 }],
    })
    const run = solveDecomposed(problem, FAST)
    const report = validatePlanningSolutionV3(problem, run.result.solution!)

    expect(report.underCoveredSlots).toBe(0)
  })

  it("refuse de rompre une continuité dure, même au prix du déficit souple", () => {
    // Le plancher exige une présence continue de 08:00 à 20:00 ; la cible
    // souple en demande deux. Les contrats ne permettent pas les deux, donc le
    // moteur doit sacrifier la CIBLE et jamais le PLANCHER.
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 480 }, { id: "b", contractMinutes: 240 }],
      days: [{ budgetMinutes: 720, opensAtMinutes: 480, closesAtMinutes: 1_200 }],
      slots: [
        {
          startMinutes: 480,
          endMinutes: 1_200,
          requiredEmployees: 2,
          hardMinimumEmployees: 1,
        },
      ],
      // Quelqu'un ouvre et quelqu'un ferme : sans cela, `exactClosingsPerDay:
      // 0` interdit à tout shift de finir à l'heure de fermeture, ce qui rend
      // la continuité jusqu'à 20:00 impossible par construction.
      rules: { minimumOpeningsPerDay: 1, exactClosingsPerDay: 1 },
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.solution).not.toBeNull()
    const report = validatePlanningSolutionV3(problem, run.result.solution!)
    // Le plancher tient — donc aucune violation bloquante.
    expect(report.violations.some((v) => v.rule === "hard-coverage-floor")).toBe(false)
    expect(report.validHardConstraints).toBe(true)
    // La cible ne tient pas — et c'est une dégradation, pas un refus.
    expect(report.underCoveredSlots).toBe(1)
  })

  it("déclare infaisable un plancher que personne ne peut atteindre", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 480 }],
      days: [{ budgetMinutes: 480, opensAtMinutes: 480, closesAtMinutes: 1_200 }],
      slots: [
        { startMinutes: 480, endMinutes: 1_200, requiredEmployees: 3, hardMinimumEmployees: 3 },
      ],
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.status).toBe("infeasible")
    expect(run.result.solution).toBeNull()
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain("hard_floor_unreachable")
  })
})

describe("garanties du moteur", () => {
  it("est déterministe : deux exécutions identiques donnent le même planning", () => {
    const problem = tinyProblem({
      employees: [
        { id: "a", contractMinutes: 720 },
        { id: "b", contractMinutes: 720 },
        { id: "c", contractMinutes: 480 },
      ],
      days: [{ budgetMinutes: 960 }, { budgetMinutes: 960 }],
      slots: [{ startMinutes: 600, endMinutes: 840, requiredEmployees: 2 }],
    })

    // Un budget volontairement serré : le déterminisme doit tenir MÊME quand
    // la recherche est coupée en cours de route, sinon la reproductibilité ne
    // vaudrait que pour les problèmes faciles.
    const budget = { timeoutMs: 10_000, maximumPlacementNodes: 120_000 } as const
    const first = solveDecomposed(problem, budget)
    const second = solveDecomposed(problem, budget)

    expect(JSON.stringify(first.result.solution)).toBe(JSON.stringify(second.result.solution))
    expect(first.report.solutionFingerprint).toBe(second.report.solutionFingerprint)
    expect(first.report.stopCause).toBe(second.report.stopCause)
  }, 60_000)

  it("ne se replie sur aucun autre moteur quand il échoue", () => {
    // Contrat impossible : 3 000 minutes en un jour plafonné à 600.
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 3_000 }],
      days: [{ budgetMinutes: 3_000 }],
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.solution).toBeNull()
    expect(run.result.status).toBe("infeasible")
    expect(run.result.diagnostics.length).toBeGreaterThan(0)
    // Un échec est diagnostiqué, jamais remplacé par le résultat d'un autre.
    expect(run.result.proof.kind).toBe("none")
  })

  it("refuse un problème malformé sans rien chercher", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 470 }],
      days: [{ budgetMinutes: 470 }],
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.status).toBe("invalid-problem")
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain("contract_off_step")
    expect(run.report.stopCause).toBe("not-started")
  })

  it("refuse un créneau désaligné du pas plutôt que d'arrondir sa couverture", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 480 }],
      days: [{ budgetMinutes: 480 }],
      slots: [{ startMinutes: 605, endMinutes: 840, requiredEmployees: 1 }],
    })
    const run = solveDecomposed(problem, FAST)

    expect(run.result.status).toBe("invalid-problem")
    expect(run.result.diagnostics.map((entry) => entry.code)).toContain("slot_off_step")
  })

  it("annonce les règles qu'il a dû supposer", () => {
    const problem = tinyProblem({
      employees: [{ id: "a", contractMinutes: 480 }],
      days: [{ budgetMinutes: 480 }],
    })
    const run = solveDecomposed(problem, FAST)

    // `maximumContinuousMinutes` n'est déclaré par aucun secteur aujourd'hui :
    // la valeur est supposée, et le moteur doit le dire plutôt que la faire
    // passer pour une règle métier.
    expect(run.report.assumedRules).toContain("maximumContinuousMinutes")
  })
})
