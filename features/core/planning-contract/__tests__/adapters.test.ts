import { describe, expect, it } from "vitest"

import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"

import {
  createDfsPrototypeAdapter,
  solveWithDfsPrototype,
  solveWithLegacyV2Adapter,
} from "@/features/core/planning-contract/adapters"
import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import {
  PlanningContractError,
  PlanningEngineNotImplementedError,
  toBackendErrorResponse,
  UnsupportedRequestContractError,
} from "@/features/core/planning-contract/errors"
import { checkSolvePlanningResponse } from "@/features/core/planning-contract/invariants"
import type { PlanningSolveAdapter } from "@/features/core/planning-contract/types/solve-response"
import { SOLVE_PLANNING_ENGINES } from "@/features/core/planning-contract/types/solve-response"

const problem = tinyProblem()
const request = buildSolvePlanningRequest(problem)

/**
 * Held as the neutral type on purpose: from here on nothing in this file can
 * tell which engine it is calling, which is the property being tested.
 */
const ADAPTERS: readonly PlanningSolveAdapter[] = [solveWithLegacyV2Adapter, solveWithDfsPrototype]

describe("adaptateurs — API unique", () => {
  it("expose la même signature pour chaque moteur du barrel navigateur", () => {
    for (const adapter of ADAPTERS) {
      expect(typeof adapter).toBe("function")
      expect(adapter.length).toBe(1)
    }
  })

  it("énumère exactement les moteurs du contrat", () => {
    expect(SOLVE_PLANNING_ENGINES).toEqual(["v2", "dfs-v3", "cp-sat", "decomposed-v3"])
  })
})

describe("adaptateur V2 hérité — refus du contrat", () => {
  it("lève unsupported-request-contract, sans repli", () => {
    // V2 consumes a V2 GenerationInput. Accepting the easy half of a V3 request
    // would answer a different question than the one asked.
    return expect(solveWithLegacyV2Adapter(request)).rejects.toBeInstanceOf(
      UnsupportedRequestContractError
    )
  })

  it("porte le code et le moteur sur l'erreur, sans analyse de message", async () => {
    try {
      await solveWithLegacyV2Adapter(request)
      expect.unreachable("l'adaptateur V2 aurait dû refuser la requête")
    } catch (error) {
      expect(error).toBeInstanceOf(PlanningContractError)
      expect((error as PlanningContractError).code).toBe("unsupported-request-contract")
      expect((error as PlanningContractError).engine).toBe("v2")
    }
  })

  it("refuse aussi une requête sans régénération, pas seulement les cas difficiles", async () => {
    const bare = buildSolvePlanningRequest(problem)
    await expect(solveWithLegacyV2Adapter(bare)).rejects.toBeInstanceOf(
      UnsupportedRequestContractError
    )
  })
})

describe("toBackendErrorResponse — la forme uniforme d'un échec", () => {
  it("normalise n'importe quelle erreur en backend-error conforme", async () => {
    const response = await solveWithLegacyV2Adapter(request).catch((error: unknown) =>
      toBackendErrorResponse("v2", error, request)
    )
    expect(response.outcome).toBe("backend-error")
    expect(response.solution).toBeNull()
    expect(response.metadata.stopCause).toBe("backend-error")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("ne conclut jamais à une infaisabilité, quelle que soit l'erreur", () => {
    // A dead service says nothing whatsoever about whether the week can be staffed.
    const errors: readonly unknown[] = [
      new Error("ECONNREFUSED"),
      new UnsupportedRequestContractError("v2", "peu importe"),
      new PlanningEngineNotImplementedError("cp-sat", "peu importe"),
      "une chaîne jetée par une librairie mal élevée",
      null,
    ]
    for (const error of errors) {
      const response = toBackendErrorResponse("cp-sat", error, request)
      expect(response.outcome).toBe("backend-error")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    }
  })

  it("compte comme non tenue toute préservation demandée avant la panne", () => {
    const regenerating = buildSolvePlanningRequest(problem, {
      preserveLockedShifts: true,
      preserveManualEdits: true,
      minimizeOtherChanges: true,
      lockedShiftIds: ["s1"],
      editedShifts: [{ shiftId: "s2", startMinute: 480, endMinute: 600 }],
    })
    const response = toBackendErrorResponse(
      "cp-sat",
      new Error("timeout réseau"),
      regenerating
    )
    expect(response.metadata.unmetPreservations).toEqual(["locks", "manual-edits", "stability"])
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })
})

describe("adaptateur DFS — première génération", () => {
  it("répond dans la forme neutre, sans vocabulaire de moteur", async () => {
    const response = await solveWithDfsPrototype(request)

    expect(response.solution).not.toBeNull()
    expect(["optimal", "feasible"]).toContain(response.outcome)
    expect(response.diagnostics.blocking).toBe(false)
    expect(response.metadata.engine).toBe("dfs-v3")
    expect(Object.keys(response).sort()).toEqual([
      "diagnostics",
      "metadata",
      "outcome",
      "solution",
    ])
  })

  it("respecte le contrat qu'il expose", () => {
    return solveWithDfsPrototype(request).then((response) => {
      expect(checkSolvePlanningResponse(response)).toEqual([])
    })
  })

  it("tient les promesses de préservation à vide quand rien n'est demandé", async () => {
    const response = await solveWithDfsPrototype(request)
    expect(response.metadata.respectedLocks).toBe(true)
    expect(response.metadata.respectedManualEdits).toBe(true)
    // Never vacuously true: nothing was stabilised because nothing asked for it.
    expect(response.metadata.minimizedOtherChanges).toBe(false)
    expect(response.metadata.unmetPreservations).toEqual([])
  })

  it("expose des détails techniques déjà rédigés", async () => {
    const response = await solveWithDfsPrototype(request)
    const labels = response.diagnostics.technical.map((fact) => fact.label)
    expect(labels).toContain("Statut du moteur")
    expect(labels).toContain("Arrêt normalisé")
    expect(labels).toContain("Empreinte de la solution")
    for (const fact of response.diagnostics.technical) {
      expect(typeof fact.value).toBe("string")
    }
  })
})

describe("adaptateur DFS — régénération", () => {
  const regenerating = buildSolvePlanningRequest(problem, {
    preserveLockedShifts: true,
    preserveManualEdits: true,
    minimizeOtherChanges: true,
    lockedShiftIds: ["s1", "s2"],
    editedShifts: [{ shiftId: "s3", startMinute: 480, endMinute: 600 }],
  })

  it("avoue ne pas savoir préserver le travail local", async () => {
    // The prototype is allowed to ignore locks. It is not allowed to be silent
    // about it: the manager learns from the response, not from the release notes.
    const response = await solveWithDfsPrototype(regenerating)
    expect(response.metadata.respectedLocks).toBe(false)
    expect(response.metadata.respectedManualEdits).toBe(false)
    expect(response.metadata.minimizedOtherChanges).toBe(false)
    expect(response.metadata.unmetPreservations).toEqual(["locks", "manual-edits", "stability"])
  })

  it("ne peut plus annoncer d'optimum, quelle que soit la qualité de la recherche", async () => {
    // THE invariant doing real work. The same problem is proven optimal on a
    // first generation; asked to keep pinned shifts it cannot keep, the very
    // same search may only call itself feasible — it optimised another problem.
    const [fresh, regenerated] = await Promise.all([
      solveWithDfsPrototype(request),
      solveWithDfsPrototype(regenerating),
    ])
    expect(fresh.outcome).toBe("optimal")
    expect(regenerated.outcome).toBe("feasible")
    expect(regenerated.metadata.optimality).toBe("feasible")
    expect(checkSolvePlanningResponse(regenerated)).toEqual([])
  })

  it("transforme chaque promesse non tenue en diagnostic", async () => {
    const response = await solveWithDfsPrototype(regenerating)
    const codes = response.diagnostics.entries.map((entry) => entry.code)
    expect(codes).toContain("locks-not-supported-by-engine")
    expect(codes).toContain("manual-edits-not-supported-by-engine")
    expect(codes).toContain("stability-not-supported-by-engine")
  })

  it("exige une acceptation explicite pour le travail perdu, sans bloquer", async () => {
    const response = await solveWithDfsPrototype(regenerating)
    expect(response.diagnostics.requiresExplicitAcceptance).toBe(true)
    // Losing pinned work is a cost a human owns; the schedule itself stays legal.
    expect(response.diagnostics.blocking).toBe(false)
    expect(response.solution).not.toBeNull()

    const lost = response.diagnostics.entries.filter(
      (entry) =>
        entry.code === "locks-not-supported-by-engine" ||
        entry.code === "manual-edits-not-supported-by-engine"
    )
    expect(lost).toHaveLength(2)
    for (const entry of lost) {
      expect(entry.severity).toBe("degradation")
      expect(entry.requiresExplicitAcceptance).toBe(true)
    }
  })

  it("ne fait pas d'une stabilité manquée une décision à prendre", async () => {
    // Nothing the manager did is lost — the rest of the week simply moves more
    // than they asked. Making it a gate would train people to click through.
    const response = await solveWithDfsPrototype(regenerating)
    const stability = response.diagnostics.entries.find(
      (entry) => entry.code === "stability-not-supported-by-engine"
    )
    expect(stability?.requiresExplicitAcceptance).toBe(false)
  })

  it("produit exactement le même planning qu'une première génération", async () => {
    // The prototype solves from scratch; the regeneration intent changes what is
    // REPORTED, never what is computed. Asserting it pins the honesty of the
    // metadata: the flags describe the engine, not a behaviour it does not have.
    const [fresh, regenerated] = await Promise.all([
      solveWithDfsPrototype(request),
      solveWithDfsPrototype(regenerating),
    ])
    expect(regenerated.solution).toEqual(fresh.solution)
  })
})

describe("adaptateur DFS — issues sans planning", () => {
  it("rend infeasible, avec preuve, quand aucun planning n'existe", async () => {
    // Contracts that cannot fit the budget: no schedule exists, and inventing an
    // empty one to satisfy a non-nullable field would be a lie in the types.
    const impossible = tinyProblem({
      employees: [{ id: "e1", contractMinutes: 10_000, canOpen: true, canClose: true }],
    })
    const response = await solveWithDfsPrototype(buildSolvePlanningRequest(impossible))

    expect(response.outcome).toBe("infeasible")
    expect(response.solution).toBeNull()
    expect(response.metadata.optimality).toBe("none")
    expect(["exhausted", "not-started"]).toContain(response.metadata.stopCause)
    expect(response.diagnostics.blocking).toBe(true)
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("rend invalid-problem sans rien chercher quand le problème est malformé", async () => {
    const malformed = { ...tinyProblem(), employees: [] }
    const response = await solveWithDfsPrototype(buildSolvePlanningRequest(malformed))

    expect(response.outcome).toBe("invalid-problem")
    expect(response.metadata.stopCause).toBe("not-started")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("rend cancelled, jamais infeasible, quand l'appelant coupe la recherche", async () => {
    // The distinction the outcome exists for: the search learned nothing, and
    // saying "impossible" here would be a verdict on the business.
    const adapter = createDfsPrototypeAdapter({ signal: { aborted: true } })
    const response = await adapter(request)

    expect(response.outcome).toBe("cancelled")
    expect(response.solution).toBeNull()
    expect(response.metadata.stopCause).toBe("cancelled")
    expect(response.metadata.optimality).toBe("none")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("rend timeout-without-solution sur une limite d'états atteinte d'emblée", async () => {
    const adapter = createDfsPrototypeAdapter({ maximumStates: 1 })
    const response = await adapter(request)

    expect(response.outcome).toBe("timeout-without-solution")
    expect(response.solution).toBeNull()
    expect(response.metadata.stopCause).toBe("state-limit")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })
})
