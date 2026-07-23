import { describe, expect, it } from "vitest"

import { fingerprintProblem } from "@/features/core/planning-v3/validator"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"

import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

import {
  driveEmployeeRecords,
  historicalSetupPayload,
  readMigratedSectors,
} from "@/features/core/planning-v3/__tests__/drive-problem"
import { solvePlanningProblemV3 } from "@/features/core/planning-v3/solver"
import { preparePlanningGeneration, runPlanningFlow } from "@/features/planning/flow"
import {
  SECTOR_SCOPE,
  sectorStoreConfig,
  smallSector,
  smallSectorEmployees,
  SMALL_SECTOR_SCOPE,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"
import { describeV3Engine, runV3Generation } from "@/features/planning/v3"
import type { PlanningV3Fetch } from "@/features/planning/v3/solve-client"

/**
 * One V3 attempt, end to end, with the network faked.
 *
 * The point of every case is the same: whatever V3 does, the caller either gets
 * a COMPLETE replacement or gets nothing at all. There is no third shape, and
 * there is no path from any failure to a V2 generation — which is what the
 * whole "no silent fallback" rule reduces to once it is written down.
 */

/** Solving and full V2 runs exceed the 5 s default; stated, not configured globally. */
const SLOW = 60_000

const EMPLOYEES = driveEmployeeRecords()
const SECTORS = readMigratedSectors(historicalSetupPayload())

function flowRequest() {
  return {
    store: sectorStoreConfig(),
    employees: EMPLOYEES,
    sectors: SECTORS,
    scope: SECTOR_SCOPE,
  }
}

function prepared() {
  const result = preparePlanningGeneration(flowRequest())
  if (result.status !== "ready") {
    throw new Error(`fixture non préparable : ${JSON.stringify(result.errors)}`)
  }
  return result
}

/** The small sector, prepared — the fixture the ACCEPTANCE cases run on. */
function smallPrepared() {
  const result = preparePlanningGeneration({
    store: storeConfig(),
    employees: smallSectorEmployees(),
    sectors: [smallSector()],
    scope: SMALL_SECTOR_SCOPE,
  })
  if (result.status !== "ready") {
    throw new Error(`fixture non préparable : ${JSON.stringify(result.errors)}`)
  }
  return result
}

/**
 * A legal schedule for the problem actually sent, solved in process.
 *
 * Produced by the V3 search rather than written by hand: a hand-written week
 * would be a second, silent implementation of the rules, and the first time one
 * of them changed the fixture would start asserting the old ones.
 */
function solveInProcess(problem: PlanningProblemV3): PlanningSolutionV3 {
  const result = solvePlanningProblemV3(problem, { timeoutMs: 20_000 })
  if (result.solution === null) {
    throw new Error(`fixture insoluble : ${result.status}`)
  }
  return result.solution
}

/** A response carrying whatever schedule a test wants, for that test's problem. */
function respond(
  problem: PlanningProblemV3,
  overrides: Partial<SolvePlanningResponse> = {}
): SolvePlanningResponse {
  const solution: PlanningSolutionV3 = {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprintProblem(problem),
    assignments: [],
  }
  return {
    outcome: "feasible",
    solution,
    diagnostics: { blocking: false, requiresExplicitAcceptance: false, entries: [], technical: [] },
    metadata: {
      engine: "cp-sat",
      respectedLocks: true,
      respectedManualEdits: true,
      minimizedOtherChanges: false,
      unmetPreservations: [],
      optimality: "feasible",
      candidateSpace: "incomplete",
      stopCause: "timeout",
    },
    ...overrides,
  }
}

/** A fetch that answers from the problem it was actually sent. */
function replyWith(
  build: (problem: PlanningProblemV3) => SolvePlanningResponse
): { fetchImpl: PlanningV3Fetch; calls: () => number } {
  let calls = 0
  return {
    calls: () => calls,
    fetchImpl: async (_path, init) => {
      calls += 1
      const problem = JSON.parse(init.body).problem as PlanningProblemV3
      return { ok: true, status: 200, text: async () => JSON.stringify(build(problem)) }
    },
  }
}

/** A response carrying a genuinely legal schedule for the problem it answers. */
function respondSolved(
  problem: PlanningProblemV3,
  overrides: Partial<SolvePlanningResponse> = {}
): SolvePlanningResponse {
  return respond(problem, { solution: solveInProcess(problem), ...overrides })
}

describe("tentative V3 — succès", () => {
  it("rend un état d'éditeur complet, prêt à remplacer l'affichage", async () => {
    const fake = replyWith(respondSolved)
    const outcome = await runV3Generation({
      prepared: smallPrepared(),
      solve: { fetchImpl: fake.fetchImpl },
    })

    expect(outcome.status).toBe("accepted")
    if (outcome.status !== "accepted") return
    expect(outcome.editorState.planning.periodStart).toBe(SMALL_SECTOR_SCOPE.period.start)
    expect(outcome.editorState.assignments.length).toBeGreaterThan(0)
    expect(outcome.editorState.shifts.length).toBe(outcome.editorState.assignments.length)
    expect(outcome.response.metadata.engine).toBe("cp-sat")
    expect(outcome.acceptance.accepted).toBe(true)
    expect(fake.calls()).toBe(1)
  }, SLOW)

  it("annonce honnêtement un optimum ou une simple faisabilité", async () => {
    const feasible = await runV3Generation({
      prepared: smallPrepared(),
      solve: { fetchImpl: replyWith(respondSolved).fetchImpl },
    })
    if (feasible.status !== "accepted") throw new Error("attendu accepté")
    expect(describeV3Engine(feasible.response)).toBe(
      "V3 expérimental — solution faisable, optimalité non prouvée"
    )

    const proven = await runV3Generation({
      prepared: smallPrepared(),
      solve: {
        fetchImpl: replyWith((problem) =>
          respondSolved(problem, {
            outcome: "optimal",
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
          })
        ).fetchImpl,
      },
    })
    if (proven.status !== "accepted") throw new Error("attendu accepté")
    expect(describeV3Engine(proven.response)).toBe("V3 expérimental — optimum démontré")
  }, SLOW)

  it("construit le problème V3 depuis la MÊME entrée que V2", async () => {
    // Two assemblies would let the two engines silently solve different weeks
    // from one screen.
    const fake = replyWith(respondSolved)
    const outcome = await runV3Generation({
      prepared: smallPrepared(),
      solve: { fetchImpl: fake.fetchImpl },
    })
    if (outcome.status !== "accepted") throw new Error("attendu accepté")

    expect(outcome.problem.period).toEqual(SMALL_SECTOR_SCOPE.period)
    expect(outcome.problem.employees.map((person) => String(person.id)).sort()).toEqual(["e1", "e2"])
  }, SLOW)

  it("transmet verrous et retouches quand une régénération est demandée", async () => {
    let sentBody = ""
    const outcome = await runV3Generation({
      prepared: smallPrepared(),
      regeneration: {
        preserveLockedShifts: true,
        preserveManualEdits: true,
        minimizeOtherChanges: true,
        lockedShiftIds: ["a1"],
        editedShifts: [{ shiftId: "a2", startMinute: 540, endMinute: 660 }],
      },
      baseline: { shifts: [] },
      solve: {
        fetchImpl: async (_path, init) => {
          sentBody = init.body
          const problem = JSON.parse(init.body).problem as PlanningProblemV3
          return { ok: true, status: 200, text: async () => JSON.stringify(respondSolved(problem)) }
        },
      },
    })

    const body = JSON.parse(sentBody)
    expect(body.regeneration.lockedShiftIds).toEqual(["a1"])
    expect(body.regeneration.editedShifts).toEqual([
      { shiftId: "a2", startMinute: 540, endMinute: 660 },
    ])
    expect(body.regeneration.minimizeOtherChanges).toBe(true)
    expect(body.baseline).toBeDefined()
    expect(outcome.status).toBe("accepted")
  }, SLOW)
})

describe("tentative V3 — échecs, sans aucun repli", () => {
  it.each([
    ["backend-error", "Le moteur V3 n'a pas pu répondre", "backend-error" as const],
    ["invalid-problem", "Le moteur V3 a refusé la demande", "not-started" as const],
    ["infeasible", "Aucun planning légal n'existe pour cette semaine en V3", "exhausted" as const],
    ["timeout-without-solution", "Le moteur V3 n'a rien trouvé dans le temps imparti", "timeout" as const],
    ["cancelled", "Recherche V3 annulée", "cancelled" as const],
  ] as const)("refuse « %s » avec un titre qui dit quoi faire", async (outcomeName, title, stopCause) => {
    const fake = replyWith((problem) =>
      respond(problem, {
        outcome: outcomeName,
        solution: null,
        diagnostics: {
          blocking: true,
          requiresExplicitAcceptance: false,
          entries: [
            { code: "raison", severity: "blocking", message: "détail", requiresExplicitAcceptance: false },
          ],
          technical: [],
        },
        metadata: {
          engine: "cp-sat",
          respectedLocks: true,
          respectedManualEdits: true,
          minimizedOtherChanges: false,
          unmetPreservations: [],
          optimality: "none",
          candidateSpace: "incomplete",
          stopCause,
        },
      })
    )

    const outcome = await runV3Generation({
      prepared: prepared(),
      solve: { fetchImpl: fake.fetchImpl },
    })

    expect(outcome.status).toBe("rejected")
    if (outcome.status !== "rejected") return
    expect(outcome.title).toBe(title)
    // Nothing to install anywhere: a rejected attempt has no editor state at all.
    expect("editorState" in outcome).toBe(false)
    expect(outcome.details).toContain("raison — détail")
  })

  it("refuse une solution que le validateur indépendant contredit", async () => {
    // The engine claims a feasible week and returns a schedule where nobody
    // works their contract. Coming back over HTTP is not evidence.
    const fake = replyWith((problem) =>
      respond(problem, {
        solution: {
          version: PLANNING_SOLUTION_V3_VERSION,
          problemFingerprint: fingerprintProblem(problem),
          assignments: [
            {
              employeeId: problem.employees[0].id,
              date: problem.days[0].date,
              segments: [{ startMinutes: 540, endMinutes: 600 }],
            },
          ],
        },
      })
    )

    const outcome = await runV3Generation({
      prepared: prepared(),
      solve: { fetchImpl: fake.fetchImpl },
    })
    expect(outcome.status).toBe("rejected")
    if (outcome.status !== "rejected") return
    expect(outcome.message).toContain("validateur indépendant")
  })

  it("refuse un planning répondant à un autre problème", async () => {
    const fake = replyWith((problem) =>
      respond(problem, {
        solution: {
          version: PLANNING_SOLUTION_V3_VERSION,
          problemFingerprint: "p3_une_autre_semaine",
          assignments: [],
        },
      })
    )
    const outcome = await runV3Generation({
      prepared: prepared(),
      solve: { fetchImpl: fake.fetchImpl },
    })
    expect(outcome.status).toBe("rejected")
  })

  it("traduit une route injoignable en refus, jamais en infaisabilité", async () => {
    const outcome = await runV3Generation({
      prepared: prepared(),
      solve: {
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED")
        },
      },
    })
    expect(outcome.status).toBe("rejected")
    if (outcome.status !== "rejected") return
    expect(outcome.response?.outcome).toBe("backend-error")
    expect(outcome.title).toBe("Le moteur V3 n'a pas pu répondre")
  })

  it("n'appelle jamais V2, quel que soit l'échec", async () => {
    // The property behind every case above, stated once: a V3 attempt performs
    // exactly one engine call — its own — and never a second one.
    const failures: SolvePlanningResponse["outcome"][] = [
      "backend-error",
      "invalid-problem",
      "infeasible",
      "timeout-without-solution",
      "cancelled",
    ]
    for (const failed of failures) {
      const fake = replyWith((problem) =>
        respond(problem, {
          outcome: failed,
          solution: null,
          diagnostics: {
            blocking: true,
            requiresExplicitAcceptance: false,
            entries: [{ code: "x", severity: "blocking", message: "m", requiresExplicitAcceptance: false }],
            technical: [],
          },
          metadata: {
            engine: "cp-sat",
            respectedLocks: true,
            respectedManualEdits: true,
            minimizedOtherChanges: false,
            unmetPreservations: [],
            optimality: "none",
            candidateSpace: "incomplete",
            stopCause:
              failed === "backend-error"
                ? "backend-error"
                : failed === "invalid-problem"
                  ? "not-started"
                  : failed === "infeasible"
                    ? "exhausted"
                    : failed === "cancelled"
                      ? "cancelled"
                      : "timeout",
          },
        })
      )
      const outcome = await runV3Generation({
        prepared: prepared(),
        solve: { fetchImpl: fake.fetchImpl },
      })
      expect(outcome.status).toBe("rejected")
      expect(fake.calls()).toBe(1)
    }
  })
})

describe("le planning V2 survit à une tentative V3", () => {
  it("reste identique, avant et après un échec V3", async () => {
    // The V2 planning is computed first, exactly as the screen would hold it.
    const v2 = runPlanningFlow(flowRequest())
    expect(v2.status).toBe("success")
    if (v2.status !== "success") return
    const before = JSON.stringify(v2.generation.assignments)

    const fake = replyWith((problem) =>
      respond(problem, {
        outcome: "backend-error",
        solution: null,
        diagnostics: {
          blocking: true,
          requiresExplicitAcceptance: false,
          entries: [
            { code: "engine-transport-failure", severity: "blocking", message: "python absent", requiresExplicitAcceptance: false },
          ],
          technical: [],
        },
        metadata: {
          engine: "cp-sat",
          respectedLocks: true,
          respectedManualEdits: true,
          minimizedOtherChanges: false,
          unmetPreservations: [],
          optimality: "none",
          candidateSpace: "incomplete",
          stopCause: "backend-error",
        },
      })
    )

    const outcome = await runV3Generation({
      prepared: prepared(),
      solve: { fetchImpl: fake.fetchImpl },
    })

    expect(outcome.status).toBe("rejected")
    // Byte-identical. The attempt could not have touched it — it never held it.
    expect(JSON.stringify(v2.generation.assignments)).toBe(before)
  }, SLOW)
})
