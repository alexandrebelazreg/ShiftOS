import { describe, expect, it } from "vitest"

import {
  HIGHS_FAST_PROTOCOL_VERSION,
  createHighsFastAdapter,
  parseHighsFastResponse,
} from "@/features/core/planning-contract/adapters/highs-fast"
import type { CpSatRunner } from "@/features/core/planning-contract/adapters/cp-sat/run-python"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import { buildAccueilCanonicalProblem } from "@/features/core/planning-v3/__tests__/accueil-canonical"

/**
 * The `v3-highs-fast` adapter, without Python.
 *
 * Every failure mode of a subprocess boundary is reachable through a fake
 * runner, and none of them needs an interpreter — which is what lets these run
 * on a machine that has never installed scipy. The one thing a fake cannot
 * prove is that the real script answers in this protocol; that is the job of
 * the end-to-end check, which skips when Python is absent.
 *
 * What every case below asserts is the same property in different clothes: a
 * transport that failed has said NOTHING about the week. Not "impossible", not
 * "empty schedule" — nothing. An engine that turns its own outage into a
 * business verdict tells a manager their shop cannot open because a pipe broke.
 */

const problem = buildAccueilCanonicalProblem()

function request(): SolvePlanningRequest {
  // A first generation: nothing local to preserve yet, so `regeneration` is
  // absent rather than empty.
  return { problem }
}

function runnerReturning(stdout: string): CpSatRunner {
  return async () => ({ kind: "success", stdout, stderr: "", durationMs: 1 }) as never
}

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    protocolVersion: HIGHS_FAST_PROTOCOL_VERSION,
    requestId: "test",
    status: "no-solution",
    assignments: [],
    diagnostics: { engineStatus: "timeout-without-solution", totalSeconds: 1 },
    environment: { python: "3.13.0" },
    error: null,
    ...overrides,
  })
}

describe("adaptateur v3-highs-fast — protocole", () => {
  it("refuse une sortie vide", () => {
    const parsed = parseHighsFastResponse("   ")
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false && parsed.code).toBe("empty-output")
  })

  it("refuse une sortie qui n'est pas du JSON", () => {
    const parsed = parseHighsFastResponse("Traceback (most recent call last):")
    expect(parsed.ok === false && parsed.code).toBe("output-not-json")
  })

  it("refuse un protocole différent de celui demandé", () => {
    // Un processus qui répond dans un protocole que nous n'avons pas demandé
    // n'est pas forcément le programme que nous croyons avoir lancé.
    const parsed = parseHighsFastResponse(
      JSON.stringify({ protocolVersion: "planning-v3-cpsat/1", status: "solved", assignments: [] })
    )
    expect(parsed.ok === false && parsed.code).toBe("protocol-version-mismatch")
  })

  it("refuse un statut hors vocabulaire", () => {
    const parsed = parseHighsFastResponse(envelope({ status: "presque" }))
    expect(parsed.ok === false && parsed.code).toBe("unknown-status")
  })

  it("refuse un `solved` sans aucune affectation", () => {
    // Une semaine vide présentée comme une génération réussie est la pire
    // sortie possible : elle passe tous les contrôles de forme et ne place
    // personne.
    const parsed = parseHighsFastResponse(envelope({ status: "solved", assignments: [] }))
    expect(parsed.ok === false && parsed.code).toBe("solved-without-assignments")
  })

  it("accepte une enveloppe conforme", () => {
    const parsed = parseHighsFastResponse(envelope())
    expect(parsed.ok).toBe(true)
  })
})

describe("adaptateur v3-highs-fast — pannes de transport", () => {
  it("rapporte un interpréteur manquant comme panne, jamais comme infaisabilité", async () => {
    const adapter = createHighsFastAdapter({
      runner: (async () => ({
        kind: "failure",
        code: "python-not-found",
        message: "spawn python ENOENT",
      })) as never,
    })
    const response = await adapter(request())

    expect(response.outcome).toBe("backend-error")
    expect(response.solution).toBeNull()
    // Le point non négociable : une panne de transport ne devient jamais un
    // verdict métier.
    expect(response.outcome).not.toBe("infeasible")
  })

  it("rapporte un processus qui plante comme panne", async () => {
    const adapter = createHighsFastAdapter({
      runner: (async () => {
        throw new Error("le tube est cassé")
      }) as never,
    })
    const response = await adapter(request())
    expect(response.outcome).toBe("backend-error")
  })

  it("rapporte une sortie illisible comme panne", async () => {
    const adapter = createHighsFastAdapter({ runner: runnerReturning("ceci n'est pas du JSON") })
    const response = await adapter(request())
    expect(response.outcome).toBe("backend-error")
  })

  it("rapporte une erreur structurée du moteur comme panne", async () => {
    const adapter = createHighsFastAdapter({
      runner: runnerReturning(
        envelope({ status: "error", error: { code: "highs-missing", message: "scipy absent" } })
      ),
    })
    const response = await adapter(request())
    expect(response.outcome).toBe("backend-error")
  })

  it("annule avant de lancer quoi que ce soit", async () => {
    let spawned = false
    const adapter = createHighsFastAdapter({
      signal: { aborted: true },
      runner: (async () => {
        spawned = true
        return { kind: "success", stdout: envelope(), stderr: "", durationMs: 1 }
      }) as never,
    })
    const response = await adapter(request())
    expect(spawned).toBe(false)
    expect(response.outcome).toBe("backend-error")
  })
})

describe("adaptateur v3-highs-fast — verdicts du moteur", () => {
  it("distingue une impossibilité démontrée d'un voisinage épuisé", async () => {
    // La distinction que ce moteur existe pour tenir. `no-solution` dit « je
    // n'ai rien trouvé » ; seul `infeasible` dit « il n'y a rien à trouver », et
    // seulement quand le modèle de demande ou le MILP d'allocation l'a prouvé.
    const exhausted = await createHighsFastAdapter({
      runner: runnerReturning(envelope({ status: "no-solution" })),
    })(request())
    const proven = await createHighsFastAdapter({
      runner: runnerReturning(
        envelope({ status: "infeasible", diagnostics: { engineStatus: "infeasible-proven" } })
      ),
    })(request())

    expect(exhausted.outcome).not.toBe("infeasible")
    expect(proven.outcome).toBe("infeasible")
  })

  it("ne revendique jamais un optimum, quel que soit le résultat", async () => {
    // Deux choix heuristiques — quels squelettes classer, quelle allocation
    // chacun reçoit — précèdent la seule étape exacte. Aucun budget ne rend un
    // planning démontrable.
    const response = await createHighsFastAdapter({
      runner: runnerReturning(envelope({ status: "no-solution" })),
    })(request())
    expect(response.outcome).not.toBe("optimal")
  })

  it("annonce qu'il ne sait pas préserver, au lieu de déverrouiller en silence", async () => {
    const withLocks: SolvePlanningRequest = {
      problem,
      regeneration: {
        preserveLockedShifts: true,
        preserveManualEdits: false,
        minimizeOtherChanges: false,
        lockedShiftIds: ["shift-1"],
        editedShifts: [],
      },
    }

    const response = await createHighsFastAdapter({
      runner: runnerReturning(envelope({ status: "no-solution" })),
    })(withLocks)

    // Un planning qui ignore un verrou n'est pas une moins bonne réponse :
    // c'est la réponse à une autre question. Le moteur ne sait pas épingler un
    // shift, et il doit le dire.
    expect(response.metadata.respectedLocks).toBe(false)
    expect(response.metadata.unmetPreservations).toContain("locks")
  })
})
