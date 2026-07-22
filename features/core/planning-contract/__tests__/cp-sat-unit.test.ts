import { describe, expect, it } from "vitest"

import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"
import type { EmployeeId } from "@/features/core/models"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"

import {
  assertNoOmittedPreservation,
  buildPreservationPlan,
  CP_SAT_PROTOCOL_VERSION,
  createCpSatAdapter,
  omittedPreservations,
  parseCpSatResponse,
} from "@/features/core/planning-contract/adapters/cp-sat"
import type { CpSatRunner } from "@/features/core/planning-contract/adapters/cp-sat"
import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import {
  checkSolvePlanningResponse,
  SolveContractViolationError,
} from "@/features/core/planning-contract/invariants"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"
import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"
import type { PlanningRegenerationRequest } from "@/features/core/planning-contract/types/regeneration"

/**
 * CP-SAT without CP-SAT.
 *
 * Every branch of the adapter except the subprocess itself is pure, so the
 * whole failure surface — a missing interpreter, a truncated pipe, a wrong
 * protocol, a solver caught lying — is exercised here in milliseconds by
 * injecting a fake runner. The suite therefore stays fast, deterministic, and
 * runnable on a machine with no Python at all; the real process is exercised
 * separately, on purpose, in `cp-sat-integration.test.ts`.
 */

const problem = tinyProblem()
const employee = (id: string): EmployeeId => id as unknown as EmployeeId

const BASELINE: PlanningBaselineV3 = {
  shifts: [
    {
      shiftId: "s1",
      employeeId: employee("e1"),
      date: "2026-07-20",
      segments: [{ startMinutes: 480, endMinutes: 600 }],
    },
    {
      shiftId: "s2",
      employeeId: employee("e2"),
      date: "2026-07-20",
      segments: [{ startMinutes: 600, endMinutes: 720 }],
    },
  ],
}

function regeneration(
  overrides: Partial<PlanningRegenerationRequest> = {}
): PlanningRegenerationRequest {
  return {
    preserveLockedShifts: true,
    preserveManualEdits: true,
    minimizeOtherChanges: false,
    lockedShiftIds: [],
    editedShifts: [],
    ...overrides,
  }
}

/** A runner that answers with whatever envelope a test wants. */
function fakeRunner(response: unknown): CpSatRunner {
  return async () => ({ kind: "stdout", stdout: JSON.stringify(response) })
}

function solvedEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocolVersion: CP_SAT_PROTOCOL_VERSION,
    requestId: "r",
    status: "solved",
    // A legal tiny-problem schedule: both employees work 120 minutes each day,
    // one opens and one closes, every slot covered.
    assignments: [
      { employeeId: "e1", date: "2026-07-20", segments: [{ startMinutes: 480, endMinutes: 600 }] },
      { employeeId: "e2", date: "2026-07-20", segments: [{ startMinutes: 600, endMinutes: 720 }] },
      { employeeId: "e1", date: "2026-07-21", segments: [{ startMinutes: 480, endMinutes: 600 }] },
      { employeeId: "e2", date: "2026-07-21", segments: [{ startMinutes: 600, endMinutes: 720 }] },
    ],
    passes: [
      { pass: "1", status: "OPTIMAL", objective: 0, bestBound: 0, proven: true, seconds: 0.1 },
      { pass: "2", status: "OPTIMAL", objective: 0, bestBound: 0, proven: true, seconds: 0.1 },
      { pass: "3", status: "OPTIMAL", objective: 0, bestBound: 0, proven: true, seconds: 0.1 },
    ],
    candidateSpace: "complete",
    stopCause: "exhausted",
    unmatchedPreservations: [],
    stability: null,
    environment: { python: "3.12.10", ortools: "9.15" },
    error: null,
    ...overrides,
  }
}

// ── Protocol ─────────────────────────────────────────────────────────────

describe("protocole CP-SAT — rien n'est pris pour acquis", () => {
  it("refuse une sortie vide", () => {
    expect(parseCpSatResponse("   ")).toMatchObject({ ok: false, code: "empty-output" })
  })

  it("refuse une sortie qui n'est pas du JSON", () => {
    expect(parseCpSatResponse("Traceback (most recent call last):")).toMatchObject({
      ok: false,
      code: "output-not-json",
    })
  })

  it("refuse un JSON qui n'est pas un objet", () => {
    expect(parseCpSatResponse("[1,2,3]")).toMatchObject({ ok: false, code: "output-not-an-object" })
  })

  it("refuse une version de protocole différente", () => {
    // An older Python that ignores `preservation` would return a schedule that
    // silently discards every lock, and it would look like a success.
    const foreign = JSON.stringify({ ...solvedEnvelope(), protocolVersion: "planning-v3-cpsat/0" })
    expect(parseCpSatResponse(foreign)).toMatchObject({ ok: false, code: "protocol-version-mismatch" })
  })

  it("refuse un statut hors protocole", () => {
    const odd = JSON.stringify({ ...solvedEnvelope(), status: "probably-fine" })
    expect(parseCpSatResponse(odd)).toMatchObject({ ok: false, code: "unknown-status" })
  })

  it("refuse une résolution aboutie sans cause d'arrêt cohérente", () => {
    const odd = JSON.stringify({ ...solvedEnvelope(), stopCause: "not-started" })
    expect(parseCpSatResponse(odd)).toMatchObject({ ok: false, code: "malformed-stop-cause" })
  })

  it("accepte une enveloppe conforme", () => {
    const parsed = parseCpSatResponse(JSON.stringify(solvedEnvelope()))
    expect(parsed.ok).toBe(true)
  })
})

// ── Preservation resolution ──────────────────────────────────────────────

describe("résolution des verrous", () => {
  it("traduit un verrou en salarié, jour et minutes exactes", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["s1"] }),
      BASELINE
    )
    const plan = buildPreservationPlan(request)
    expect(plan.lockedAssignments).toEqual([
      { shiftId: "s1", employeeId: "e1", date: "2026-07-20", startMinutes: 480, endMinutes: 600 },
    ])
    expect(plan.unresolved).toEqual([])
    expect(plan.missingBaseline).toBe(false)
  })

  it("exige un planning de référence dès qu'un verrou est réellement demandé", () => {
    // An id without the schedule that minted it names nothing.
    const request = buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["s1"] }))
    const plan = buildPreservationPlan(request)
    expect(plan.missingBaseline).toBe(true)
    expect(plan.lockedAssignments).toEqual([])
  })

  it("traite un planning de référence vide comme absent", () => {
    const request = buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["s1"] }), {
      shifts: [],
    })
    expect(buildPreservationPlan(request).missingBaseline).toBe(true)
  })

  it("n'exige aucun planning de référence pour un drapeau sans travail local", () => {
    // "Preserve my locks" with no locks is satisfied by any schedule.
    const request = buildSolvePlanningRequest(problem, regeneration())
    const plan = buildPreservationPlan(request)
    expect(plan.missingBaseline).toBe(false)
    expect(plan.unresolved).toEqual([])
  })

  it("signale un verrou dont le shift a disparu, sans l'ignorer", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["s404"] }),
      BASELINE
    )
    const plan = buildPreservationPlan(request)
    expect(plan.unresolved).toMatchObject([
      { kind: "lock", shiftId: "s404", reason: "shift-absent-from-baseline" },
    ])
  })

  it("refuse de verrouiller une coupure, que le modèle ne sait pas reproduire", () => {
    const split: PlanningBaselineV3 = {
      shifts: [
        {
          shiftId: "sc",
          employeeId: employee("e1"),
          date: "2026-07-20",
          segments: [
            { startMinutes: 480, endMinutes: 540 },
            { startMinutes: 600, endMinutes: 660 },
          ],
        },
      ],
    }
    const request = buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["sc"] }), split)
    expect(buildPreservationPlan(request).unresolved).toMatchObject([
      { kind: "lock", shiftId: "sc", reason: "split-shift-not-expressible" },
    ])
  })

  it("signale un verrou portant sur un salarié absent du problème", () => {
    const foreign: PlanningBaselineV3 = {
      shifts: [
        {
          shiftId: "sx",
          employeeId: employee("inconnu"),
          date: "2026-07-20",
          segments: [{ startMinutes: 480, endMinutes: 600 }],
        },
      ],
    }
    const request = buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["sx"] }), foreign)
    expect(buildPreservationPlan(request).unresolved).toMatchObject([
      { kind: "lock", shiftId: "sx", reason: "employee-absent-from-problem" },
    ])
  })

  it("n'impose rien quand le manager a décoché la préservation des verrous", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ preserveLockedShifts: false, lockedShiftIds: ["s1"] }),
      BASELINE
    )
    const plan = buildPreservationPlan(request)
    expect(plan.lockedAssignments).toEqual([])
    expect(plan.unresolved).toEqual([])
    expect(plan.missingBaseline).toBe(false)
  })
})

describe("résolution des retouches manuelles", () => {
  it("traduit une retouche en contrainte dure sur le même salarié et le même jour", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ editedShifts: [{ shiftId: "s1", startMinute: 540, endMinute: 660 }] }),
      BASELINE
    )
    const plan = buildPreservationPlan(request)
    expect(plan.editedAssignments).toEqual([
      { shiftId: "s1", employeeId: "e1", date: "2026-07-20", startMinutes: 540, endMinutes: 660 },
    ])
    expect(plan.unresolved).toEqual([])
  })

  it.each([
    ["horaires inversés", { shiftId: "s1", startMinute: 600, endMinute: 480 }, "geometry-inverted"],
    ["hors du pas de temps", { shiftId: "s1", startMinute: 485, endMinute: 605 }, "geometry-not-on-time-step"],
    ["hors de la plage du jour", { shiftId: "s1", startMinute: 300, endMinute: 420 }, "geometry-outside-day-window"],
    ["trop courte", { shiftId: "s1", startMinute: 480, endMinute: 480 }, "geometry-inverted"],
    ["shift inconnu", { shiftId: "s404", startMinute: 480, endMinute: 600 }, "shift-absent-from-baseline"],
  ])("refuse une retouche %s au lieu de la corriger", (_label, edit, reason) => {
    const request = buildSolvePlanningRequest(problem, regeneration({ editedShifts: [edit] }), BASELINE)
    expect(buildPreservationPlan(request).unresolved).toMatchObject([{ kind: "manual-edit", reason }])
  })

  it("refuse une retouche plus longue que la durée maximale légale", () => {
    const strict = tinyProblem({ rules: { maximumShiftMinutes: 120 } })
    const request = buildSolvePlanningRequest(
      strict,
      regeneration({ editedShifts: [{ shiftId: "s1", startMinute: 480, endMinute: 720 }] }),
      BASELINE
    )
    expect(buildPreservationPlan(request).unresolved).toMatchObject([
      { kind: "manual-edit", reason: "duration-outside-shift-bounds" },
    ])
  })
})

describe("référence de stabilité", () => {
  it("mesure la dérive depuis ce que le manager a sous les yeux, retouches comprises", () => {
    // Using the pre-edit geometry would count their own deliberate change as
    // drift and push the solver to undo it.
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({
        minimizeOtherChanges: true,
        editedShifts: [{ shiftId: "s1", startMinute: 540, endMinute: 660 }],
      }),
      BASELINE
    )
    const plan = buildPreservationPlan(request)
    expect(plan.baselineAssignments).toContainEqual({
      shiftId: "s1",
      employeeId: "e1",
      date: "2026-07-20",
      startMinutes: 540,
      endMinutes: 660,
    })
    expect(plan.stabilityUnmeasurable).toBe(false)
  })

  it("signale une stabilité demandée sans référence à laquelle rester proche", () => {
    const request = buildSolvePlanningRequest(problem, regeneration({ minimizeOtherChanges: true }))
    expect(buildPreservationPlan(request).stabilityUnmeasurable).toBe(true)
  })
})

// ── Adapter behaviour, with a fake process ───────────────────────────────

describe("adaptateur CP-SAT — issues normalisées", () => {
  const request = buildSolvePlanningRequest(problem)

  it("rend optimal quand tout est prouvé, complet et respecté", async () => {
    const response = await createCpSatAdapter({ runner: fakeRunner(solvedEnvelope()) })(request)
    expect(response.outcome).toBe("optimal")
    expect(response.metadata.optimality).toBe("optimal")
    expect(response.metadata.candidateSpace).toBe("complete")
    expect(response.metadata.stopCause).toBe("exhausted")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("retombe sur feasible dès qu'une passe n'est pas prouvée", async () => {
    const partial = solvedEnvelope({
      passes: [
        { pass: "1", status: "OPTIMAL", objective: 0, bestBound: 0, proven: true, seconds: 0.1 },
        { pass: "2", status: "FEASIBLE", objective: 0, bestBound: 0, proven: false, seconds: 9 },
      ],
      stopCause: "timeout",
    })
    const response = await createCpSatAdapter({ runner: fakeRunner(partial) })(request)
    expect(response.outcome).toBe("feasible")
    expect(response.metadata.stopCause).toBe("timeout")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("interdit optimal sur un espace de candidats incomplet", async () => {
    // Split shifts are not enumerated: an optimum over part of the space is an
    // optimum of a smaller question.
    const reduced = solvedEnvelope({ candidateSpace: "incomplete" })
    const response = await createCpSatAdapter({ runner: fakeRunner(reduced) })(request)
    expect(response.outcome).toBe("feasible")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("rend infeasible sur une preuve, jamais sur un délai", async () => {
    const proof = solvedEnvelope({ status: "infeasible", assignments: [], stopCause: "exhausted" })
    const response = await createCpSatAdapter({ runner: fakeRunner(proof) })(request)
    expect(response.outcome).toBe("infeasible")
    expect(response.solution).toBeNull()
    expect(response.metadata.stopCause).toBe("exhausted")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("rend timeout-without-solution quand le budget expire sans solution", async () => {
    const late = solvedEnvelope({ status: "no-solution", assignments: [], stopCause: "timeout" })
    const response = await createCpSatAdapter({ runner: fakeRunner(late) })(request)
    expect(response.outcome).toBe("timeout-without-solution")
    expect(response.metadata.stopCause).toBe("timeout")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("rend invalid-problem quand le modèle refuse le problème", async () => {
    const refused = solvedEnvelope({
      status: "invalid-problem",
      assignments: [],
      stopCause: "not-started",
      error: { code: "model-error", message: "KeyError: 'employees'" },
    })
    const response = await createCpSatAdapter({ runner: fakeRunner(refused) })(request)
    expect(response.outcome).toBe("invalid-problem")
    expect(response.metadata.stopCause).toBe("not-started")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("rend cancelled, jamais infeasible, quand l'appelant coupe", async () => {
    const adapter = createCpSatAdapter({
      runner: async () => ({ kind: "cancelled" }),
      signal: { aborted: false },
    })
    const response = await adapter(request)
    expect(response.outcome).toBe("cancelled")
    expect(response.metadata.stopCause).toBe("cancelled")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("n'appelle même pas le processus quand l'annulation précède le départ", async () => {
    let called = false
    const adapter = createCpSatAdapter({
      runner: async () => {
        called = true
        return { kind: "cancelled" }
      },
      signal: { aborted: true },
    })
    expect((await adapter(request)).outcome).toBe("cancelled")
    expect(called).toBe(false)
  })
})

describe("adaptateur CP-SAT — aucune panne ne devient une infaisabilité", () => {
  const request = buildSolvePlanningRequest(problem)

  it.each([
    ["python introuvable", { kind: "failure" as const, code: "python-not-found" as const, message: "ENOENT" }],
    ["processus tué par le délai", { kind: "failure" as const, code: "process-timeout" as const, message: "tué" }],
    ["processus planté", { kind: "failure" as const, code: "process-crashed" as const, message: "exit 3" }],
    ["processus interrompu", { kind: "failure" as const, code: "process-killed" as const, message: "SIGKILL" }],
  ])("traduit %s en backend-error", async (_label, outcome) => {
    const response = await createCpSatAdapter({ runner: async () => outcome })(request)
    expect(response.outcome).toBe("backend-error")
    expect(response.metadata.stopCause).toBe("backend-error")
    expect(response.solution).toBeNull()
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("traduit une absence d'OR-Tools en backend-error", async () => {
    const missing = solvedEnvelope({
      status: "error",
      assignments: [],
      stopCause: "not-started",
      error: { code: "ortools-missing", message: "No module named 'ortools'" },
    })
    const response = await createCpSatAdapter({ runner: fakeRunner(missing) })(request)
    expect(response.outcome).toBe("backend-error")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("traduit une sortie illisible en backend-error", async () => {
    const adapter = createCpSatAdapter({
      runner: async () => ({ kind: "stdout", stdout: "Traceback (most recent call last): ..." }),
    })
    const response = await adapter(request)
    expect(response.outcome).toBe("backend-error")
    expect(response.diagnostics.entries[0].message).toContain("output-not-json")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("traduit un runner qui lève en backend-error", async () => {
    const adapter = createCpSatAdapter({
      runner: async () => {
        throw new Error("le pipe a explosé")
      },
    })
    expect((await adapter(request)).outcome).toBe("backend-error")
  })

  it("refuse un moteur qui a résolu un autre problème", async () => {
    const wrong = solvedEnvelope({ problemFingerprint: "p3_pas_le_bon" })
    const response = await createCpSatAdapter({ runner: fakeRunner(wrong) })(request)
    expect(response.outcome).toBe("backend-error")
    expect(response.diagnostics.entries[0].message).toContain("un autre problème")
  })
})

describe("adaptateur CP-SAT — validation indépendante", () => {
  const request = buildSolvePlanningRequest(problem)

  it("ne fait jamais passer pour feasible un planning que le validateur rejette", async () => {
    // "It came back on stdout" is not evidence. Here CP-SAT claims a proven
    // optimum while returning a schedule that breaks the weekly contract.
    const lying = solvedEnvelope({
      assignments: [
        { employeeId: "e1", date: "2026-07-20", segments: [{ startMinutes: 480, endMinutes: 540 }] },
      ],
    })
    const response = await createCpSatAdapter({ runner: fakeRunner(lying) })(request)

    expect(response.outcome).toBe("backend-error")
    expect(response.solution).toBeNull()
    expect(response.diagnostics.entries[0].code).toBe("solver-contradicted-by-validator")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("reconstruit la solution avec l'empreinte du problème réellement posé", async () => {
    const response = await createCpSatAdapter({ runner: fakeRunner(solvedEnvelope()) })(request)
    expect(response.solution?.version).toBe(PLANNING_SOLUTION_V3_VERSION)
    expect(response.solution?.problemFingerprint).toMatch(/^p3_/)
  })
})

describe("adaptateur CP-SAT — aucune résolution relâchée", () => {
  /** Records whether the subprocess was reached at all. */
  function spyRunner(): { runner: CpSatRunner; called: () => boolean } {
    let called = false
    return {
      runner: async () => {
        called = true
        return { kind: "stdout", stdout: JSON.stringify(solvedEnvelope()) }
      },
      called: () => called,
    }
  }

  it("refuse un verrou demandé sans planning de référence, sans lancer Python", async () => {
    const spy = spyRunner()
    const request = buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["s1"] }))
    const response = await createCpSatAdapter({ runner: spy.runner })(request)

    expect(response.outcome).toBe("invalid-problem")
    expect(response.metadata.stopCause).toBe("not-started")
    expect(response.diagnostics.entries[0].code).toBe("missing-baseline-for-preservations")
    expect(spy.called()).toBe(false)
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("refuse une retouche demandée sans planning de référence, sans lancer Python", async () => {
    const spy = spyRunner()
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ editedShifts: [{ shiftId: "s1", startMinute: 540, endMinute: 660 }] })
    )
    const response = await createCpSatAdapter({ runner: spy.runner })(request)

    expect(response.outcome).toBe("invalid-problem")
    expect(response.diagnostics.entries[0].code).toBe("missing-baseline-for-preservations")
    expect(spy.called()).toBe(false)
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("n'exige aucun planning de référence quand le drapeau ne protège rien", async () => {
    // The flag alone asks for nothing, so it must not block a first generation.
    const spy = spyRunner()
    const response = await createCpSatAdapter({ runner: spy.runner })(
      buildSolvePlanningRequest(problem, regeneration())
    )

    expect(response.outcome).toBe("optimal")
    expect(spy.called()).toBe(true)
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("refuse un verrou inconnu de la baseline, en nommant l'identifiant et le type", async () => {
    const spy = spyRunner()
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["s404"] }),
      BASELINE
    )
    const response = await createCpSatAdapter({ runner: spy.runner })(request)

    expect(response.outcome).toBe("invalid-problem")
    expect(response.metadata.stopCause).toBe("not-started")
    expect(response.diagnostics.entries[0].code).toBe("unknown-preserved-shift")
    expect(response.diagnostics.entries[0].message).toContain("s404")
    expect(response.diagnostics.entries[0].message).toContain("Verrou")
    expect(spy.called()).toBe(false)
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("refuse une retouche inconnue de la baseline, en nommant l'identifiant et le type", async () => {
    const spy = spyRunner()
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ editedShifts: [{ shiftId: "e404", startMinute: 540, endMinute: 660 }] }),
      BASELINE
    )
    const response = await createCpSatAdapter({ runner: spy.runner })(request)

    expect(response.outcome).toBe("invalid-problem")
    expect(response.diagnostics.entries[0].code).toBe("unknown-preserved-shift")
    expect(response.diagnostics.entries[0].message).toContain("e404")
    expect(response.diagnostics.entries[0].message).toContain("Retouche")
    expect(spy.called()).toBe(false)
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("refuse une retouche illégale plutôt que de la corriger", async () => {
    const spy = spyRunner()
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ editedShifts: [{ shiftId: "s1", startMinute: 485, endMinute: 605 }] }),
      BASELINE
    )
    const response = await createCpSatAdapter({ runner: spy.runner })(request)

    expect(response.outcome).toBe("invalid-problem")
    expect(response.diagnostics.entries[0].code).toBe(
      "unpreservable-shift:geometry-not-on-time-step"
    )
    expect(spy.called()).toBe(false)
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("refuse le résultat quand le modèle n'a pas su exprimer un verrou envoyé", async () => {
    // The backstop. Python could not pin the constraint, so it solved a LOOSER
    // problem — and a legal-looking schedule for another question is worse than
    // no schedule.
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["s1"] }),
      BASELINE
    )
    const unmatched = solvedEnvelope({
      unmatchedPreservations: [
        { kind: "lockedAssignments", shiftId: "s1", reason: "no-legal-candidate-matches-geometry" },
      ],
    })
    const response = await createCpSatAdapter({ runner: fakeRunner(unmatched) })(request)

    expect(response.outcome).toBe("invalid-problem")
    expect(response.solution).toBeNull()
    expect(response.diagnostics.entries[0].code).toBe(
      "unpreservable-shift:no-legal-candidate-matches-geometry"
    )
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("garde optimal quand le verrou demandé a bien été imposé", async () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["s1"] }),
      BASELINE
    )
    const response = await createCpSatAdapter({ runner: fakeRunner(solvedEnvelope()) })(request)
    expect(response.outcome).toBe("optimal")
    expect(response.metadata.respectedLocks).toBe(true)
    expect(response.metadata.unmetPreservations).toEqual([])
  })

  it("ne rend jamais optimal ni feasible en ayant omis un verrou ou une retouche", async () => {
    // The property, swept across every shape a request can take. Whatever comes
    // back, it is never a schedule that dropped one of the manager's decisions.
    const cases = [
      buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["s1"] })),
      buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["s404"] }), BASELINE),
      buildSolvePlanningRequest(
        problem,
        regeneration({ editedShifts: [{ shiftId: "s404", startMinute: 540, endMinute: 660 }] }),
        BASELINE
      ),
      buildSolvePlanningRequest(
        problem,
        regeneration({ editedShifts: [{ shiftId: "s1", startMinute: 485, endMinute: 605 }] }),
        BASELINE
      ),
      buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["s1"] }), BASELINE),
    ]

    for (const request of cases) {
      const response = await createCpSatAdapter({ runner: fakeRunner(solvedEnvelope()) })(request)
      if (response.solution !== null) {
        expect(response.metadata.unmetPreservations).not.toContain("locks")
        expect(response.metadata.unmetPreservations).not.toContain("manual-edits")
        expect(response.metadata.respectedLocks).toBe(true)
        expect(response.metadata.respectedManualEdits).toBe(true)
      } else {
        expect(["invalid-problem", "infeasible", "backend-error"]).toContain(response.outcome)
      }
      expect(checkSolvePlanningResponse(response)).toEqual([])
    }
  })

  it("exige une preuve avant de parler d'infaisabilité", async () => {
    // An infeasibility that was not demonstrated is not one, whatever the
    // envelope claims.
    const unproven = solvedEnvelope({
      status: "infeasible",
      assignments: [],
      stopCause: "timeout",
    })
    const response = await createCpSatAdapter({ runner: fakeRunner(unproven) })(
      buildSolvePlanningRequest(problem)
    )
    expect(response.outcome).toBe("backend-error")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("nomme les préservations imposées sans les accuser, quand rien n'existe", async () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["s1"] }),
      BASELINE
    )
    const proof = solvedEnvelope({ status: "infeasible", assignments: [], stopCause: "exhausted" })
    const response = await createCpSatAdapter({ runner: fakeRunner(proof) })(request)

    expect(response.outcome).toBe("infeasible")
    expect(response.metadata.stopCause).toBe("exhausted")
    const named = response.diagnostics.entries.find(
      (entry) => entry.code === "preservations-participating-in-infeasibility"
    )
    expect(named?.message).toContain("s1")
    expect(named?.message).toContain("nécessairement l'unique cause")
    expect(named?.severity).toBe("information")
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("interdit optimal quand la stabilité est demandée sans référence", async () => {
    const request = buildSolvePlanningRequest(problem, regeneration({ minimizeOtherChanges: true }))
    const response = await createCpSatAdapter({ runner: fakeRunner(solvedEnvelope()) })(request)

    expect(response.outcome).toBe("feasible")
    expect(response.metadata.unmetPreservations).toEqual(["stability"])
    expect(response.metadata.minimizedOtherChanges).toBe(false)
    expect(checkSolvePlanningResponse(response)).toEqual([])
  })

  it("annonce la stabilité tenue quand la passe 4 a réellement tourné", async () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ minimizeOtherChanges: true }),
      BASELINE
    )
    const stable = solvedEnvelope({
      passes: [
        ...(solvedEnvelope().passes as unknown[]),
        { pass: "4", status: "OPTIMAL", objective: 0, bestBound: 0, proven: true, seconds: 0.2 },
      ],
      stability: {
        driftMinutes: 0,
        removedShifts: 0,
        addedShifts: 2,
        startShiftMinutes: 0,
        endShiftMinutes: 0,
      },
    })
    const response = await createCpSatAdapter({ runner: fakeRunner(stable) })(request)

    expect(response.metadata.minimizedOtherChanges).toBe(true)
    expect(response.metadata.unmetPreservations).toEqual([])
    expect(response.outcome).toBe("optimal")
    expect(response.diagnostics.technical.map((fact) => fact.label)).toContain(
      "Dérive au planning de référence"
    )
  })
})

describe("garde-fou anti-relâchement", () => {
  const answered = (
    outcome: "optimal" | "feasible",
    unmet: readonly ("locks" | "manual-edits" | "stability")[]
  ): SolvePlanningResponse => ({
    outcome,
    solution: {
      version: PLANNING_SOLUTION_V3_VERSION,
      problemFingerprint: "p3_x",
      assignments: [],
    },
    diagnostics: { blocking: false, requiresExplicitAcceptance: false, entries: [], technical: [] },
    metadata: {
      engine: "cp-sat",
      respectedLocks: !unmet.includes("locks"),
      respectedManualEdits: !unmet.includes("manual-edits"),
      minimizedOtherChanges: false,
      unmetPreservations: unmet,
      optimality: outcome === "optimal" ? "optimal" : "feasible",
      candidateSpace: "complete",
      stopCause: outcome === "optimal" ? "exhausted" : "timeout",
    },
  })

  it("ne voit aucune omission dans une réponse sans planning", () => {
    // Refusing to answer is not dropping anything.
    const refused: SolvePlanningResponse = {
      ...answered("feasible", ["locks"]),
      solution: null,
      outcome: "invalid-problem",
    }
    expect(omittedPreservations(refused)).toEqual([])
    expect(assertNoOmittedPreservation(refused)).toBe(refused)
  })

  it("ignore la stabilité, qui est un objectif et non une décision du manager", () => {
    const response = answered("feasible", ["stability"])
    expect(omittedPreservations(response)).toEqual([])
    expect(assertNoOmittedPreservation(response)).toBe(response)
  })

  it.each([
    ["optimal", "locks"],
    ["optimal", "manual-edits"],
    ["feasible", "locks"],
    ["feasible", "manual-edits"],
  ] as const)("lève sur un %s ayant omis « %s »", (outcome, preservation) => {
    const relaxed = answered(outcome, [preservation])
    expect(omittedPreservations(relaxed)).toEqual([preservation])
    // A defect in the mapping, not a fact about the week: it must fail loudly
    // at the boundary that produced it rather than degrade into an answer.
    expect(() => assertNoOmittedPreservation(relaxed)).toThrow(SolveContractViolationError)
    expect(() => assertNoOmittedPreservation(relaxed)).toThrow(/omis/)
  })

  it("laisse passer une réponse qui a tout respecté", () => {
    const clean = answered("optimal", [])
    expect(assertNoOmittedPreservation(clean)).toBe(clean)
  })
})

describe("adaptateur CP-SAT — enveloppe émise", () => {
  it("envoie le protocole, le problème, les préservations résolues et les options", async () => {
    let sent = ""
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["s1"], minimizeOtherChanges: true }),
      BASELINE
    )
    const adapter = createCpSatAdapter({
      seed: 7,
      workers: 1,
      timeoutSeconds: 12,
      runner: async (payload) => {
        sent = payload
        return { kind: "stdout", stdout: JSON.stringify(solvedEnvelope()) }
      },
    })
    await adapter(request)

    const envelope = JSON.parse(sent)
    expect(envelope.protocolVersion).toBe(CP_SAT_PROTOCOL_VERSION)
    expect(envelope.requestId).toMatch(/^p3_/)
    expect(envelope.problem.version).toBe(problem.version)
    expect(envelope.preservation.lockedAssignments).toHaveLength(1)
    expect(envelope.preservation.minimizeOtherChanges).toBe(true)
    expect(envelope.preservation.baselineAssignments).toHaveLength(2)
    expect(envelope.options).toEqual({ timeoutSeconds: 12, seed: 7, workers: 1 })
  })

  it("n'envoie aucune référence de stabilité quand elle n'est pas demandée", async () => {
    let sent = ""
    const request = buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["s1"] }), BASELINE)
    await createCpSatAdapter({
      runner: async (payload) => {
        sent = payload
        return { kind: "stdout", stdout: JSON.stringify(solvedEnvelope()) }
      },
    })(request)

    expect(JSON.parse(sent).preservation.baselineAssignments).toEqual([])
  })
})
