import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import type { EmployeeId, PlanningId, StoreId } from "@/features/core/models"
import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem } from "@/features/core/planning-v3/validator"

import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

import type { EditorState } from "@/features/planning/editor"
import {
  baselineFromEditorState,
  solvePlanningV3OverHttp,
  v3ShiftId,
  v3ShiftsAndAssignments,
} from "@/features/planning/v3"

const problem = tinyProblem()
const brand = <T,>(value: string): T => value as unknown as T

const SOLUTION: PlanningSolutionV3 = {
  version: PLANNING_SOLUTION_V3_VERSION,
  problemFingerprint: fingerprintProblem(problem),
  assignments: [
    { employeeId: brand<EmployeeId>("e1"), date: "2026-07-20", segments: [{ startMinutes: 480, endMinutes: 600 }] },
    { employeeId: brand<EmployeeId>("e2"), date: "2026-07-20", segments: [{ startMinutes: 600, endMinutes: 720 }] },
  ],
}

const CONTEXT = {
  solution: SOLUTION,
  coreInput: { store: { id: brand<StoreId>("store_1") } } as never,
  configuration: {} as never,
  settings: { planningId: brand<PlanningId>("planning_1"), now: "2026-07-19T00:00:00.000Z" } as never,
}

// ── The V3 solution, re-expressed for the existing screen ─────────────────

describe("traduction d'une solution V3 vers l'état de l'éditeur", () => {
  it("produit un shift et une affectation par assignation", () => {
    const { shifts, assignments } = v3ShiftsAndAssignments(CONTEXT)
    expect(shifts).toHaveLength(2)
    expect(assignments).toHaveLength(2)
  })

  it("convertit les minutes en horaires du modèle", () => {
    const { shifts } = v3ShiftsAndAssignments(CONTEXT)
    expect(shifts[0].segments).toEqual([{ startTime: "08:00", endTime: "10:00" }])
  })

  it("mint des identifiants stables : même solution, mêmes identifiants", () => {
    const first = v3ShiftsAndAssignments(CONTEXT)
    const second = v3ShiftsAndAssignments(CONTEXT)
    expect(first.shifts.map((shift) => shift.id)).toEqual(second.shifts.map((shift) => shift.id))
    expect(first.shifts[0].id).toBe(v3ShiftId("e1", "2026-07-20"))
  })

  it("ne revendique aucune provenance de bibliothèque", () => {
    // V3 picks start and duration freely inside the legal space; claiming a
    // template would be a false provenance.
    const { shifts } = v3ShiftsAndAssignments(CONTEXT)
    expect(shifts.every((shift) => shift.templateId === null)).toBe(true)
    expect(shifts.every((shift) => shift.source === "dynamic")).toBe(true)
  })

  it("laisse les affectations à l'état proposé, la confirmation étant la publication", () => {
    const { assignments } = v3ShiftsAndAssignments(CONTEXT)
    expect(assignments.every((assignment) => assignment.status === "proposed")).toBe(true)
  })
})

describe("planning de référence pour une régénération", () => {
  it("désigne les shifts par l'identifiant que le tableau expose", () => {
    // The board keys its locks by ASSIGNMENT id, so a lock taken from the UI has
    // to resolve against this baseline with no translation in between.
    const { shifts, assignments } = v3ShiftsAndAssignments(CONTEXT)
    const state = { shifts, assignments } as unknown as EditorState
    const baseline = baselineFromEditorState(state)

    expect(baseline.shifts.map((shift) => shift.shiftId)).toEqual(
      assignments.map((assignment) => String(assignment.id))
    )
    expect(baseline.shifts[0]).toMatchObject({
      employeeId: "e1",
      date: "2026-07-20",
      segments: [{ startMinutes: 480, endMinutes: 600 }],
    })
  })

  it("ignore une affectation dont le shift a disparu plutôt que de mentir sur sa géométrie", () => {
    const { assignments } = v3ShiftsAndAssignments(CONTEXT)
    const state = { shifts: [], assignments } as unknown as EditorState
    expect(baselineFromEditorState(state).shifts).toEqual([])
  })
})

// ── The HTTP boundary, without a server ───────────────────────────────────

describe("client V3 — aucune panne ne devient une infaisabilité", () => {
  const request = buildSolvePlanningRequest(problem)

  it("envoie la version de frontière, le problème et le délai", async () => {
    let sent = ""
    await solvePlanningV3OverHttp(request, {
      timeoutSeconds: 42,
      fetchImpl: async (_path, init) => {
        sent = init.body
        return { ok: true, status: 200, text: async () => JSON.stringify(accepted()) }
      },
    })
    const body = JSON.parse(sent)
    expect(body.endpointVersion).toBe("planning-v3-solve/1")
    expect(body.problem.version).toBe(problem.version)
    expect(body.timeoutSeconds).toBe(42)
  })

  it("traduit une route injoignable en backend-error", async () => {
    const response = await solvePlanningV3OverHttp(request, {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED")
      },
    })
    expect(response.outcome).toBe("backend-error")
    expect(response.metadata.stopCause).toBe("backend-error")
    expect(response.solution).toBeNull()
  })

  it("traduit une réponse illisible en backend-error", async () => {
    const response = await solvePlanningV3OverHttp(request, {
      fetchImpl: async () => ({ ok: false, status: 500, text: async () => "<html>oops</html>" }),
    })
    expect(response.outcome).toBe("backend-error")
  })

  it("traduit un refus de la frontière en backend-error, jamais en planning", async () => {
    // The route refuses malformed requests with a `{code, message}` body. It is
    // not a `SolvePlanningResponse`, and must never be read as one.
    const response = await solvePlanningV3OverHttp(request, {
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ code: "endpoint-version-mismatch", message: "non" }),
      }),
    })
    expect(response.outcome).toBe("backend-error")
    expect(response.diagnostics.entries[0].message).toContain("endpoint-version-mismatch")
  })

  it("compte comme non tenues les préservations demandées quand le transport tombe", async () => {
    const regenerating = buildSolvePlanningRequest(
      problem,
      {
        preserveLockedShifts: true,
        preserveManualEdits: true,
        minimizeOtherChanges: true,
        lockedShiftIds: ["s1"],
        editedShifts: [{ shiftId: "s2", startMinute: 480, endMinute: 600 }],
      },
      { shifts: [] }
    )
    const response = await solvePlanningV3OverHttp(regenerating, {
      fetchImpl: async () => {
        throw new Error("réseau coupé")
      },
    })
    expect(response.metadata.unmetPreservations).toEqual(["locks", "manual-edits", "stability"])
  })

  it("rend telle quelle une réponse conforme", async () => {
    const response = await solvePlanningV3OverHttp(request, {
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(accepted()) }),
    })
    expect(response.outcome).toBe("optimal")
    expect(response.solution).not.toBeNull()
  })
})

function accepted(): SolvePlanningResponse {
  return {
    outcome: "optimal",
    solution: SOLUTION,
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
  }
}

// ── The guarantees the screen makes, asserted on its source ───────────────

describe("écran Planning — garanties structurelles", () => {
  const VIEW = readFileSync(
    join(process.cwd(), "features", "planning", "view", "PlanningView.tsx"),
    "utf8"
  )

  it("démarre sur le moteur par défaut, jamais sur une constante écrite à la main", () => {
    expect(VIEW).toContain("useState<PlanningEngineVersion>(CURRENT_PLANNING_ENGINE_VERSION)")
  })

  it("n'appelle jamais la génération V2 depuis le chemin V3", () => {
    // THE no-fallback guarantee. `handleGenerateV3` must contain no call to the
    // V2 path anywhere between its opening and the next function.
    const body = VIEW.slice(
      VIEW.indexOf("async function handleGenerateV3"),
      VIEW.indexOf("function handleReturnToV2")
    )
    expect(body.length).toBeGreaterThan(200)
    expect(body).not.toContain("handleGenerateV2(")
    expect(body).not.toContain("runPlanningFlow(")
  })

  it("ne touche pas au planning affiché quand V3 échoue", () => {
    // Everything between the rejection test and its `return` must do nothing but
    // record the failure.
    const rejection = VIEW.slice(
      VIEW.indexOf('if (outcome.status === "rejected")'),
      VIEW.indexOf('setV3({ status: "rejected", outcome })')
    )
    expect(rejection).not.toContain("setEditorState")
    expect(rejection).not.toContain("setRecord")
    expect(rejection).not.toContain("planningStore")
  })

  it("offre un retour à V2 sans régénérer", () => {
    const body = VIEW.slice(
      VIEW.indexOf("function handleReturnToV2"),
      VIEW.indexOf("function handleGenerateV2")
    )
    expect(body).toContain('setEngine("v2")')
    expect(body).not.toContain("runPlanningFlow(")
    expect(body).not.toContain("handleGenerateV2(")
    expect(VIEW).toContain("Revenir à V2")
  })

  it("affiche le moteur du planning courant, et non celui qui est sélectionné", () => {
    expect(VIEW).toContain("activeEngineLabel")
    expect(VIEW).toContain("PLANNING_ENGINE_LABELS[activeEngine]")
  })

  it("transmet la régénération ET le moteur choisi", () => {
    expect(VIEW).toContain("function handleGenerate(regeneration?: PlanningRegenerationRequest)")
    expect(VIEW).toContain("void handleGenerateV3(verdict.scope, engine, regeneration)")
  })

  it("route chaque moteur V3 vers son propre solveur, sans repli entre eux", () => {
    // Le choix du moteur voyage avec la requête. Il ne peut pas être deviné
    // côté serveur : c'est une décision par exécution, prise par la personne
    // qui clique.
    expect(VIEW).toContain('engine: version === "v3-decomposed" ? "decomposed" : "cp-sat"')
  })

  it("teste l'appartenance au pipeline V3 par un prédicat, jamais par une égalité littérale", () => {
    // Un `=== "v3"` littéral oublié dans un seul des sept endroits ferait
    // silencieusement retomber un écran V3 en V2.
    expect(VIEW).toContain("usesV3Pipeline(activeEngine)")
    expect(VIEW).toContain("usesV3Pipeline(engine)")
    expect(VIEW).not.toContain('activeEngine === "v3"')
    expect(VIEW).not.toContain('engine === "v3"')
  })
})

describe("tableau de planning — les verrous voyagent avec la régénération", () => {
  it("construit la requête de régénération au moment de régénérer", () => {
    const board = readFileSync(
      join(process.cwd(), "features", "planning", "board", "ui", "PlanningBoard.tsx"),
      "utf8"
    )
    // Dropping them here would make "préserver mes verrous" a checkbox that
    // does nothing.
    expect(board).toContain("onGenerate?.(buildRegenerationRequest(editState, regenerateOptions))")
  })
})
