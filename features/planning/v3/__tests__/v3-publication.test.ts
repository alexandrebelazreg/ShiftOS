import { describe, expect, it } from "vitest"

import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem } from "@/features/core/planning-v3/validator"

import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

import { decidePublication } from "@/features/planning/board"
import { acceptV3Result } from "@/features/planning/v3"

/**
 * What a V3 planning is allowed to become.
 *
 * The V3 publish gate is the V2 publish gate — `decidePublication`, unchanged —
 * fed from the V3 audit instead of the V2 report. That is deliberate: a second
 * gate would be a second definition of "may this be published", free to drift
 * from the first, and publication is the one irreversible action on this screen.
 *
 * The interesting property is that a V3 schedule breaking a hard rule never
 * even reaches the gate. It is refused at acceptance, so there is no planning to
 * publish — which is a stronger guarantee than a disabled button.
 */

const problem = tinyProblem()
const request = buildSolvePlanningRequest(problem)

function response(overrides: Partial<SolvePlanningResponse> = {}): SolvePlanningResponse {
  return {
    outcome: "feasible",
    solution: {
      version: PLANNING_SOLUTION_V3_VERSION,
      problemFingerprint: fingerprintProblem(problem),
      assignments: [
        { employeeId: "e1" as never, date: "2026-07-20", segments: [{ startMinutes: 480, endMinutes: 600 }] },
        { employeeId: "e2" as never, date: "2026-07-20", segments: [{ startMinutes: 600, endMinutes: 720 }] },
        { employeeId: "e1" as never, date: "2026-07-21", segments: [{ startMinutes: 480, endMinutes: 600 }] },
        { employeeId: "e2" as never, date: "2026-07-21", segments: [{ startMinutes: 600, endMinutes: 720 }] },
      ],
    },
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

describe("publication d'un planning V3", () => {
  it("publie directement un planning V3 propre", () => {
    const acceptance = acceptV3Result(request, response())
    expect(acceptance.accepted).toBe(true)
    if (!acceptance.accepted) return

    expect(
      decidePublication({
        hasBlockingViolation: false,
        requiresExplicitAcceptance: acceptance.requiresExplicitAcceptance,
        underCoveredSlots: acceptance.report.underCoveredSlots,
      })
    ).toBe("publish-directly")
  })

  it("exige une acceptation explicite quand le planning V3 porte des réserves", () => {
    // A coverage shortfall is legal and costly: displayable, publishable only
    // once someone has knowingly taken it on.
    const short = tinyProblem({ slotRequirement: 2 })
    const acceptance = acceptV3Result(
      buildSolvePlanningRequest(short),
      response({
        solution: { ...response().solution!, problemFingerprint: fingerprintProblem(short) },
      })
    )
    expect(acceptance.accepted).toBe(true)
    if (!acceptance.accepted) return

    expect(acceptance.requiresExplicitAcceptance).toBe(true)
    expect(
      decidePublication({
        hasBlockingViolation: false,
        requiresExplicitAcceptance: true,
        underCoveredSlots: acceptance.report.underCoveredSlots,
      })
    ).toBe("require-explicit-acceptance")
  })

  it("ne laisse jamais un planning V3 en violation dure atteindre la publication", () => {
    // Refused before it is a planning at all — there is nothing to publish,
    // rather than something publishable behind a disabled button.
    const broken = response({
      solution: { ...response().solution!, assignments: [response().solution!.assignments[0]] },
    })
    const acceptance = acceptV3Result(request, broken)

    expect(acceptance.accepted).toBe(false)
    if (acceptance.accepted) return
    expect(acceptance.reason).toBe("hard-constraints-violated")
    // And had it somehow reached the gate, the gate would refuse it too.
    expect(
      decidePublication({
        hasBlockingViolation: true,
        requiresExplicitAcceptance: false,
        underCoveredSlots: 0,
      })
    ).toBe("block-publication")
  })

  it("bloque la publication d'une issue qui ne porte aucun planning", () => {
    const failed = response({
      outcome: "backend-error",
      solution: null,
      diagnostics: {
        blocking: true,
        requiresExplicitAcceptance: false,
        entries: [
          { code: "engine-transport-failure", severity: "blocking", message: "x", requiresExplicitAcceptance: false },
        ],
        technical: [],
      },
      metadata: { ...response().metadata, optimality: "none", stopCause: "backend-error" },
    })
    expect(acceptV3Result(request, failed).accepted).toBe(false)
    expect(
      decidePublication({ hasBlockingViolation: true, requiresExplicitAcceptance: false })
    ).toBe("block-publication")
  })
})
