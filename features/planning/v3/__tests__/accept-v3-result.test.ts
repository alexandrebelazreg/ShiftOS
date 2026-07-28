import { describe, expect, it } from "vitest"

import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"
import {
  CURRENT_PLANNING_ENGINE_VERSION,
  PLANNING_ENGINE_LABELS,
  usesV3Pipeline,
  PLANNING_ENGINE_VERSIONS,
  isPlanningEngineVersion,
} from "@/features/core/planning-v3/types/engine-version"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem } from "@/features/core/planning-v3/validator"

import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

import { acceptV3Result, describeV3Engine, v3TechnicalCaveats } from "@/features/planning/v3"

/**
 * The gate between a CP-SAT answer and a manager's screen.
 *
 * Every case below is a way a V3 result can be wrong while still LOOKING like a
 * schedule — the shapes that would pass a casual `if (response.solution)` and
 * put a bad week in front of someone. None of them reaches for V2.
 */

const problem = tinyProblem()
const request = buildSolvePlanningRequest(problem)

/** A legal tiny-problem week: two people, 120 minutes each, every slot covered. */
const LEGAL: PlanningSolutionV3 = {
  version: PLANNING_SOLUTION_V3_VERSION,
  problemFingerprint: fingerprintProblem(problem),
  assignments: [
    { employeeId: "e1" as never, date: "2026-07-20", segments: [{ startMinutes: 480, endMinutes: 600 }] },
    { employeeId: "e2" as never, date: "2026-07-20", segments: [{ startMinutes: 600, endMinutes: 720 }] },
    { employeeId: "e1" as never, date: "2026-07-21", segments: [{ startMinutes: 480, endMinutes: 600 }] },
    { employeeId: "e2" as never, date: "2026-07-21", segments: [{ startMinutes: 600, endMinutes: 720 }] },
  ],
}

function response(overrides: Partial<SolvePlanningResponse> = {}): SolvePlanningResponse {
  return {
    outcome: "optimal",
    solution: LEGAL,
    diagnostics: { blocking: false, requiresExplicitAcceptance: false, entries: [], technical: [] },
    metadata: {
      engine: "cp-sat",
      respectedLocks: true,
      respectedManualEdits: true,
      minimizedOtherChanges: false,
      unmetPreservations: [],
      optimality: "optimal",
      candidateSpace: "complete",
      stopCause: "exhausted",
    },
    ...overrides,
  }
}

describe("sélecteur de moteur", () => {
  it("offre V2 et les deux moteurs V3 : le mode shadow n'existe toujours pas", () => {
    expect([...PLANNING_ENGINE_VERSIONS]).toEqual([
      "v2",
      "v3",
      "v3-decomposed",
      "v3-highs-fast",
    ])
    // Le shadow reste supprimé : un second planning que personne ne regarde
    // n'est pas devenu une bonne idée parce qu'un troisième moteur existe.
    expect(isPlanningEngineVersion("v3-shadow")).toBe(false)
  })

  it("garde V2 comme valeur par défaut malgré l'ajout d'un moteur", () => {
    // What runs for someone who never opened the control. Adding an
    // experimental engine must never change this.
    expect(CURRENT_PLANNING_ENGINE_VERSION).toBe("v2")
  })

  it("nomme chaque moteur une seule fois, pour tous les écrans", () => {
    expect(PLANNING_ENGINE_LABELS).toEqual({
      v2: "V2 stable",
      v3: "V3 expérimental",
      "v3-decomposed": "V3 décomposé",
      "v3-highs-fast": "V3 rapide (HiGHS)",
    })
  })

  it("range les deux moteurs V3 dans le même pipeline, et V2 en dehors", () => {
    // Le prédicat existe pour que l'ajout d'un moteur V3 ne laisse pas six
    // comparaisons littérales `=== "v3"` retomber silencieusement en V2.
    expect(usesV3Pipeline("v2")).toBe(false)
    expect(usesV3Pipeline("v3")).toBe(true)
    expect(usesV3Pipeline("v3-decomposed")).toBe(true)
    expect(usesV3Pipeline("v3-highs-fast")).toBe(true)
  })
})

describe("acceptation d'un résultat V3 — cas nominal", () => {
  it("accepte un optimum prouvé et rend le rapport du validateur", () => {
    const acceptance = acceptV3Result(request, response())
    expect(acceptance.accepted).toBe(true)
    if (!acceptance.accepted) return
    expect(acceptance.solution).toBe(LEGAL)
    expect(acceptance.report.validHardConstraints).toBe(true)
  })

  it("accepte une solution faisable et le dit sans l'embellir", () => {
    const feasible = response({
      outcome: "feasible",
      metadata: { ...response().metadata, optimality: "feasible", stopCause: "timeout" },
    })
    const acceptance = acceptV3Result(request, feasible)
    expect(acceptance.accepted).toBe(true)
    expect(describeV3Engine(feasible)).toBe(
      "V3 expérimental (CP-SAT) — solution faisable, optimalité non prouvée"
    )
  })

  it("annonce un optimum uniquement quand il est prouvé", () => {
    expect(describeV3Engine(response())).toBe("V3 expérimental (CP-SAT) — optimum démontré")
  })
})

describe("acceptation d'un résultat V3 — refus", () => {
  it.each(["backend-error", "invalid-problem", "infeasible", "timeout-without-solution", "cancelled"] as const)(
    "refuse d'afficher une issue « %s »",
    (outcome) => {
      const refused = response({
        outcome,
        solution: null,
        diagnostics: {
          blocking: true,
          requiresExplicitAcceptance: false,
          entries: [{ code: "x", severity: "blocking", message: "m", requiresExplicitAcceptance: false }],
          technical: [],
        },
        metadata: {
          ...response().metadata,
          optimality: "none",
          stopCause: outcome === "backend-error" ? "backend-error" : outcome === "cancelled" ? "cancelled" : outcome === "invalid-problem" ? "not-started" : outcome === "infeasible" ? "exhausted" : "timeout",
        },
      })
      const acceptance = acceptV3Result(request, refused)
      expect(acceptance.accepted).toBe(false)
      if (acceptance.accepted) return
      expect(acceptance.reason).toBe("outcome-not-publishable")
    }
  )

  it("refuse une réponse qui annonce un planning sans en joindre un", () => {
    const acceptance = acceptV3Result(request, response({ solution: null }))
    expect(acceptance.accepted).toBe(false)
    if (acceptance.accepted) return
    // Reported as the missing schedule it is, before the contract check gets a
    // chance to describe it as a shape problem — the caller needs the plainer
    // of the two reasons.
    expect(acceptance.reason).toBe("no-solution")
  })

  it("refuse une réponse incohérente avec le contrat", () => {
    const broken = response({
      metadata: { ...response().metadata, optimality: "none" },
    })
    const acceptance = acceptV3Result(request, broken)
    expect(acceptance.accepted).toBe(false)
    if (acceptance.accepted) return
    expect(acceptance.reason).toBe("contract-violated")
  })

  it("refuse un planning qui répond à un autre problème", () => {
    // A stale or replayed response would otherwise be published under this
    // week's header.
    const stale = response({
      solution: { ...LEGAL, problemFingerprint: "p3_une_autre_semaine" },
    })
    const acceptance = acceptV3Result(request, stale)
    expect(acceptance.accepted).toBe(false)
    if (acceptance.accepted) return
    expect(acceptance.reason).toBe("wrong-problem")
  })

  it("refuse un planning que le validateur indépendant rejette", () => {
    // The engine claims a proven optimum; the schedule breaks the weekly
    // contract. "It came back over HTTP" is not evidence.
    const lying = response({
      solution: {
        ...LEGAL,
        assignments: [LEGAL.assignments[0]],
      },
    })
    const acceptance = acceptV3Result(request, lying)
    expect(acceptance.accepted).toBe(false)
    if (acceptance.accepted) return
    expect(acceptance.reason).toBe("hard-constraints-violated")
    expect(acceptance.report?.validHardConstraints).toBe(false)
  })

  it("refuse un planning qui a omis une préservation demandée", () => {
    const regenerating = buildSolvePlanningRequest(
      problem,
      {
        preserveLockedShifts: true,
        preserveManualEdits: false,
        minimizeOtherChanges: false,
        lockedShiftIds: ["s1"],
        editedShifts: [],
      },
      { shifts: [] }
    )
    const dropped = response({
      outcome: "feasible",
      metadata: {
        ...response().metadata,
        optimality: "feasible",
        stopCause: "timeout",
        respectedLocks: false,
        unmetPreservations: ["locks"],
      },
    })
    const acceptance = acceptV3Result(regenerating, dropped)
    expect(acceptance.accepted).toBe(false)
    if (acceptance.accepted) return
    expect(acceptance.reason).toBe("preservation-not-respected")
  })
})

describe("dégradations et détail technique", () => {
  it("laisse afficher un planning légal portant des réserves, acceptation requise", () => {
    // A coverage shortfall is a cost someone owns, not a reason to hide the week.
    const short = tinyProblem({ slotRequirement: 2 })
    const shortRequest = buildSolvePlanningRequest(short)
    const acceptance = acceptV3Result(
      shortRequest,
      response({
        solution: { ...LEGAL, problemFingerprint: fingerprintProblem(short) },
        outcome: "feasible",
        metadata: { ...response().metadata, optimality: "feasible", stopCause: "timeout" },
      })
    )
    expect(acceptance.accepted).toBe(true)
    if (!acceptance.accepted) return
    expect(acceptance.requiresExplicitAcceptance).toBe(true)
  })

  it("signale les coupures non couvertes dans le détail, pas sur l'écran principal", () => {
    const withSplits = tinyProblem({ rules: { splitShiftAllowed: true } })
    const caveats = v3TechnicalCaveats(
      response({ metadata: { ...response().metadata, candidateSpace: "incomplete" } }),
      withSplits
    )
    expect(caveats[0].label).toBe("Espace de recherche incomplet")
    expect(caveats[0].value).toContain("coupures")
  })

  it("n'ajoute aucune réserve quand l'espace est complet", () => {
    const caveats = v3TechnicalCaveats(response(), problem)
    expect(caveats.some((entry) => entry.label === "Espace de recherche incomplet")).toBe(false)
  })
})
