import { describe, expect, it } from "vitest"

import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem } from "@/features/core/planning-v3/validator"

import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

import { acceptV3Result } from "@/features/planning/v3"

/**
 * Ce qu'un résultat V3 a le droit de devenir.
 *
 * Il y avait ici une seconde moitié : la porte de publication, `decidePublication`,
 * nourrie par l'audit V3. Publier a disparu de l'écran — enregistrer suffit
 * désormais à rendre un rayon affichable — et cette porte avec lui.
 *
 * Ce qui reste est la garantie FORTE, celle qui ne dépendait d'aucun bouton :
 * un planning V3 en violation dure n'est jamais devenu un planning. Il est
 * refusé à l'acceptation, donc il n'y a rien à afficher — ce qui vaut mieux
 * qu'un planning affichable derrière un bouton grisé. Ce filet-là compte plus
 * qu'avant, puisqu'il n'y a plus de second contrôle derrière lui.
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

    expect(acceptance.requiresExplicitAcceptance).toBe(false)
    expect(acceptance.report.underCoveredSlots).toBe(0)
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

    // Une réserve de couverture reste LÉGALE : elle est acceptée, donc
    // enregistrable et affichable, et c'est le bandeau sous la grille qui la
    // nomme. Elle n'a jamais bloqué quoi que ce soit, et le bandeau discret
    // est désormais le seul endroit qui la dise.
    expect(acceptance.requiresExplicitAcceptance).toBe(true)
    expect(acceptance.report.underCoveredSlots).toBeGreaterThan(0)
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
  })
})
