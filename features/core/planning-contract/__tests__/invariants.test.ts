import { describe, expect, it } from "vitest"

import {
  assertSolvePlanningResponse,
  checkSolvePlanningResponse,
  isPublishableOutcome,
  isValidSolvePlanningResponse,
  SolveContractViolationError,
} from "@/features/core/planning-contract/invariants"
import {
  ENGINE_FAILURE_KINDS,
  optimalityForOutcome,
  outcomeOfEngineFailure,
  PROVING_FAILURE_KINDS,
  SOLVE_PLANNING_OUTCOMES,
} from "@/features/core/planning-contract/types/solve-outcome"
import type {
  EngineFailureKind,
  SolvePlanningOutcome,
} from "@/features/core/planning-contract/types/solve-outcome"
import { BACKEND_FAILURE_DIAGNOSTIC_CODES } from "@/features/core/planning-contract/types/solve-response"
import type {
  SolveDiagnostic,
  SolvePlanningMetadata,
  SolvePlanningResponse,
} from "@/features/core/planning-contract/types/solve-response"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"

const SOLUTION: PlanningSolutionV3 = {
  version: PLANNING_SOLUTION_V3_VERSION,
  problemFingerprint: "p3_test",
  assignments: [],
}

const BLOCKING: SolveDiagnostic = {
  code: "coverage-deficit",
  severity: "blocking",
  message: "bloquant",
  requiresExplicitAcceptance: false,
}

/**
 * A response that satisfies every invariant, built for each outcome.
 *
 * Each test then breaks exactly one thing. Starting from a valid response and
 * corrupting one field is what makes a failure attributable: a fixture built
 * wrong in two ways proves nothing about which rule caught it.
 */
function validResponse(outcome: SolvePlanningOutcome): SolvePlanningResponse {
  const carries = outcome === "optimal" || outcome === "feasible"
  const metadata: SolvePlanningMetadata = {
    engine: "dfs-v3",
    respectedLocks: true,
    respectedManualEdits: true,
    minimizedOtherChanges: false,
    unmetPreservations: [],
    optimality: optimalityForOutcome(outcome),
    candidateSpace: outcome === "optimal" ? "complete" : "incomplete",
    stopCause: stopCauseFor(outcome),
  }
  return {
    outcome,
    solution: carries ? SOLUTION : null,
    diagnostics: {
      blocking: !carries,
      requiresExplicitAcceptance: false,
      entries: carries ? [] : [BLOCKING],
      technical: [],
    },
    metadata,
  }
}

function stopCauseFor(outcome: SolvePlanningOutcome): SolvePlanningMetadata["stopCause"] {
  switch (outcome) {
    case "optimal":
      return "exhausted"
    case "feasible":
      return "timeout"
    case "infeasible":
      return "exhausted"
    case "invalid-problem":
      return "not-started"
    case "timeout-without-solution":
      return "timeout"
    case "cancelled":
      return "cancelled"
    case "backend-error":
      return "backend-error"
  }
}

function codesOf(response: SolvePlanningResponse): readonly string[] {
  return checkSolvePlanningResponse(response).map((violation) => violation.code)
}

describe("invariants — les réponses saines passent", () => {
  it("accepte une réponse valide pour chacune des sept issues", () => {
    for (const outcome of SOLVE_PLANNING_OUTCOMES) {
      expect(codesOf(validResponse(outcome))).toEqual([])
    }
  })

  it("expose les sept issues normalisées, sans doublon", () => {
    expect([...SOLVE_PLANNING_OUTCOMES]).toEqual([
      "optimal",
      "feasible",
      "infeasible",
      "invalid-problem",
      "timeout-without-solution",
      "cancelled",
      "backend-error",
    ])
    expect(new Set(SOLVE_PLANNING_OUTCOMES).size).toBe(SOLVE_PLANNING_OUTCOMES.length)
  })

  it("ne juge publiables que les deux issues qui portent un planning", () => {
    const publishable = SOLVE_PLANNING_OUTCOMES.filter(isPublishableOutcome)
    expect(publishable).toEqual(["optimal", "feasible"])
  })
})

describe("invariants — optimal et feasible exigent une solution", () => {
  it("refuse un optimum sans planning", () => {
    const response = { ...validResponse("optimal"), solution: null }
    expect(codesOf(response)).toContain("outcome-requires-solution")
  })

  it("refuse un feasible sans planning", () => {
    const response = { ...validResponse("feasible"), solution: null }
    expect(codesOf(response)).toContain("outcome-requires-solution")
  })
})

describe("invariants — infeasible et invalid-problem n'ont pas de solution", () => {
  it("refuse un planning joint à une infaisabilité", () => {
    const response = { ...validResponse("infeasible"), solution: SOLUTION }
    expect(codesOf(response)).toContain("outcome-forbids-solution")
  })

  it("refuse un planning joint à un problème malformé", () => {
    const response = { ...validResponse("invalid-problem"), solution: SOLUTION }
    expect(codesOf(response)).toContain("outcome-forbids-solution")
  })

  it("refuse une infaisabilité qui ne repose sur aucune preuve", () => {
    // Neither a timeout nor a cancellation proves anything about the problem.
    for (const stopCause of ["timeout", "state-limit", "cancelled", "backend-error"] as const) {
      const base = validResponse("infeasible")
      const response = { ...base, metadata: { ...base.metadata, stopCause } }
      expect(codesOf(response)).toContain("infeasible-requires-proof")
    }
  })

  it("refuse un problème malformé qui prétend avoir cherché", () => {
    const base = validResponse("invalid-problem")
    const response = { ...base, metadata: { ...base.metadata, stopCause: "exhausted" as const } }
    expect(codesOf(response)).toContain("invalid-problem-requires-no-search")
  })
})

describe("invariants — une erreur backend ne devient jamais infeasible", () => {
  it("ne classe en infeasible que les échecs qui portent une preuve", () => {
    const infeasibleKinds = ENGINE_FAILURE_KINDS.filter(
      (kind) => outcomeOfEngineFailure(kind) === "infeasible"
    )
    expect(infeasibleKinds).toEqual(["proven-infeasible", "exhausted-without-solution"])
  })

  it("classe toute panne moteur en backend-error", () => {
    const backendKinds: readonly EngineFailureKind[] = [
      "transport",
      "unsupported-request-contract",
      "engine-contradicted-by-validator",
    ]
    for (const kind of backendKinds) {
      expect(outcomeOfEngineFailure(kind)).toBe("backend-error")
    }
  })

  it("n'attribue aucune conclusion sur le problème à un échec qui n'en porte pas", () => {
    // The rule stated positively: only a proving failure may produce an outcome
    // that says something about the problem itself.
    const verdicts: readonly SolvePlanningOutcome[] = ["infeasible", "invalid-problem"]
    for (const kind of ENGINE_FAILURE_KINDS) {
      if (PROVING_FAILURE_KINDS.includes(kind)) continue
      expect(verdicts).not.toContain(outcomeOfEngineFailure(kind))
    }
  })

  it("refuse un diagnostic de panne moteur porté par une autre issue que backend-error", () => {
    for (const code of BACKEND_FAILURE_DIAGNOSTIC_CODES) {
      const base = validResponse("infeasible")
      const response: SolvePlanningResponse = {
        ...base,
        diagnostics: {
          ...base.diagnostics,
          entries: [{ ...BLOCKING, code }],
        },
      }
      expect(codesOf(response)).toContain("backend-failure-must-not-become-a-verdict")
    }
  })

  it("laisse passer le même diagnostic sous l'issue backend-error", () => {
    const base = validResponse("backend-error")
    const response: SolvePlanningResponse = {
      ...base,
      diagnostics: {
        ...base.diagnostics,
        entries: [{ ...BLOCKING, code: "engine-transport-failure" }],
      },
    }
    expect(codesOf(response)).toEqual([])
  })
})

describe("invariants — un timeout avec solution est feasible, avec cause explicite", () => {
  it("refuse toute autre issue quand un délai a rendu un planning", () => {
    for (const outcome of SOLVE_PLANNING_OUTCOMES) {
      if (outcome === "feasible") continue
      const base = validResponse(outcome)
      const response: SolvePlanningResponse = {
        ...base,
        solution: SOLUTION,
        metadata: { ...base.metadata, stopCause: "timeout" },
      }
      expect(codesOf(response)).toContain("timeout-with-solution-must-be-feasible")
    }
  })

  it("accepte le cas nominal : délai atteint, planning légal, feasible", () => {
    expect(isValidSolvePlanningResponse(validResponse("feasible"))).toBe(true)
    expect(validResponse("feasible").metadata.stopCause).toBe("timeout")
  })

  it("refuse un feasible qui ne dit pas pourquoi il s'est arrêté là", () => {
    const base = validResponse("feasible")
    const response = { ...base, metadata: { ...base.metadata, stopCause: "not-started" as const } }
    expect(codesOf(response)).toContain("feasible-requires-explicit-stop-cause")
  })

  it("exige une limite déclarée derrière un timeout sans solution", () => {
    const base = validResponse("timeout-without-solution")
    const response = { ...base, metadata: { ...base.metadata, stopCause: "exhausted" as const } }
    expect(codesOf(response)).toContain("timeout-without-solution-requires-declared-limit")
  })

  it("admet un plafond d'états comme limite déclarée", () => {
    const base = validResponse("timeout-without-solution")
    const response = { ...base, metadata: { ...base.metadata, stopCause: "state-limit" as const } }
    expect(codesOf(response)).toEqual([])
  })

  it("exige l'arrêt « cancelled » derrière une annulation", () => {
    const base = validResponse("cancelled")
    const response = { ...base, metadata: { ...base.metadata, stopCause: "timeout" as const } }
    expect(codesOf(response)).toContain("cancelled-requires-cancelled-stop")
  })
})

describe("invariants — optimal est interdit sur un espace incomplet", () => {
  it("refuse un optimum annoncé sur un espace incomplet", () => {
    const base = validResponse("optimal")
    const response = {
      ...base,
      metadata: { ...base.metadata, candidateSpace: "incomplete" as const },
    }
    expect(codesOf(response)).toContain("optimal-requires-complete-space")
  })

  it("refuse un optimum qui n'a pas épuisé son espace", () => {
    for (const stopCause of ["timeout", "state-limit", "cancelled", "not-started"] as const) {
      const base = validResponse("optimal")
      const response = { ...base, metadata: { ...base.metadata, stopCause } }
      expect(codesOf(response)).toContain("optimal-requires-exhaustive-stop")
    }
  })
})

describe("invariants — optimal est interdit si une préservation demandée a échoué", () => {
  it("refuse un optimum qui a perdu les verrous", () => {
    const base = validResponse("optimal")
    const response = {
      ...base,
      metadata: {
        ...base.metadata,
        respectedLocks: false,
        unmetPreservations: ["locks"] as const,
      },
    }
    expect(codesOf(response)).toContain("optimal-requires-every-preservation")
  })

  it("refuse un optimum qui a perdu les retouches manuelles", () => {
    const base = validResponse("optimal")
    const response = {
      ...base,
      metadata: {
        ...base.metadata,
        respectedManualEdits: false,
        unmetPreservations: ["manual-edits"] as const,
      },
    }
    expect(codesOf(response)).toContain("optimal-requires-every-preservation")
  })

  it("refuse un optimum qui a ignoré la stabilité demandée", () => {
    // Optimal for a problem nobody posed is not optimal.
    const base = validResponse("optimal")
    const response = {
      ...base,
      metadata: { ...base.metadata, unmetPreservations: ["stability"] as const },
    }
    expect(codesOf(response)).toContain("optimal-requires-every-preservation")
  })

  it("laisse feasible porter exactement les mêmes promesses non tenues", () => {
    // The downgrade is the point: the answer is still useful, it just may not
    // call itself an optimum.
    const base = validResponse("feasible")
    const response = {
      ...base,
      metadata: {
        ...base.metadata,
        respectedLocks: false,
        unmetPreservations: ["locks"] as const,
      },
    }
    expect(codesOf(response)).toEqual([])
  })
})

describe("invariants — cohérence interne", () => {
  it("exige que l'optimalité suive l'issue", () => {
    const base = validResponse("feasible")
    const response = { ...base, metadata: { ...base.metadata, optimality: "optimal" as const } }
    expect(codesOf(response)).toContain("optimality-disagrees-with-outcome")
  })

  it("exige un diagnostic bloquant derrière toute issue sans planning", () => {
    for (const outcome of SOLVE_PLANNING_OUTCOMES) {
      if (outcome === "optimal" || outcome === "feasible") continue
      const base = validResponse(outcome)
      const response: SolvePlanningResponse = {
        ...base,
        diagnostics: { ...base.diagnostics, blocking: false, entries: [] },
      }
      expect(codesOf(response)).toContain("unpublishable-outcome-requires-blocking-diagnostic")
    }
  })

  it("refuse un planning annoncé légal et contredit par un diagnostic bloquant", () => {
    const base = validResponse("feasible")
    const response: SolvePlanningResponse = {
      ...base,
      diagnostics: { ...base.diagnostics, blocking: true, entries: [BLOCKING] },
    }
    expect(codesOf(response)).toContain("publishable-outcome-forbids-blocking-diagnostic")
  })

  it("refuse un drapeau bloquant qui ment sur ses entrées", () => {
    const base = validResponse("feasible")
    const response: SolvePlanningResponse = {
      ...base,
      diagnostics: { ...base.diagnostics, blocking: true, entries: [] },
    }
    expect(codesOf(response)).toContain("blocking-flag-disagrees-with-entries")
  })

  it("refuse un drapeau d'acceptation qui ment sur ses entrées", () => {
    const base = validResponse("feasible")
    const response: SolvePlanningResponse = {
      ...base,
      diagnostics: { ...base.diagnostics, requiresExplicitAcceptance: true },
    }
    expect(codesOf(response)).toContain("acceptance-flag-disagrees-with-entries")
  })

  it("refuse une promesse non tenue contredite par son booléen résumé", () => {
    const base = validResponse("feasible")
    const response = {
      ...base,
      metadata: {
        ...base.metadata,
        respectedLocks: true,
        unmetPreservations: ["locks"] as const,
      },
    }
    expect(codesOf(response)).toContain("unmet-locks-disagrees-with-respected-flag")
  })

  it("refuse une stabilité à la fois non tenue et annoncée optimisée", () => {
    const base = validResponse("feasible")
    const response = {
      ...base,
      metadata: {
        ...base.metadata,
        minimizedOtherChanges: true,
        unmetPreservations: ["stability"] as const,
      },
    }
    expect(codesOf(response)).toContain("unmet-stability-disagrees-with-minimized-flag")
  })

  it("rejette d'emblée un vocabulaire inconnu, sans appliquer les autres règles", () => {
    // A rule that silently passes on an unknown value is worse than no rule.
    const response = { ...validResponse("feasible"), outcome: "probably-fine" } as unknown as SolvePlanningResponse
    expect(codesOf(response)).toEqual(["unknown-outcome"])
  })

  it("signale toutes les infractions à la fois, pas seulement la première", () => {
    const base = validResponse("optimal")
    const response: SolvePlanningResponse = {
      ...base,
      solution: null,
      metadata: { ...base.metadata, candidateSpace: "incomplete", stopCause: "timeout" },
    }
    expect(codesOf(response)).toEqual(
      expect.arrayContaining([
        "outcome-requires-solution",
        "optimal-requires-complete-space",
        "optimal-requires-exhaustive-stop",
      ])
    )
  })
})

describe("assertSolvePlanningResponse", () => {
  it("rend la réponse telle quelle quand elle est conforme", () => {
    const response = validResponse("optimal")
    expect(assertSolvePlanningResponse(response)).toBe(response)
  })

  it("lève une erreur qui porte les infractions, pas seulement un message", () => {
    const response = { ...validResponse("optimal"), solution: null }
    try {
      assertSolvePlanningResponse(response)
      expect.unreachable("la réponse non conforme aurait dû lever")
    } catch (error) {
      expect(error).toBeInstanceOf(SolveContractViolationError)
      expect((error as SolveContractViolationError).violations.map((v) => v.code)).toContain(
        "outcome-requires-solution"
      )
    }
  })
})
