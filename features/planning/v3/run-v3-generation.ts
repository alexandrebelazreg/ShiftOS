import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"
import type { PlanningRegenerationRequest } from "@/features/core/planning-contract/types/regeneration"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

import type { EditorState } from "@/features/planning/editor"
import type { PreparedPlanningGeneration } from "@/features/planning/flow"
import { acceptV3Result, type V3Acceptance } from "@/features/planning/v3/accept-v3-result"
import { editorStateFromV3Solution } from "@/features/planning/v3/editor-state-from-v3"
import { solvePlanningV3OverHttp, type SolveV3Options } from "@/features/planning/v3/solve-client"

/**
 * One V3 attempt, end to end, as a value.
 *
 * The shape is the point: an attempt either produces a COMPLETE replacement —
 * a new editor state, its audit, and the response behind it — or it produces a
 * failure and nothing else. There is no partial outcome, because a partial
 * outcome is exactly what would tempt a caller into keeping half of it, and
 * half a schedule replacing a whole one is how a working V2 planning gets lost.
 *
 * Nothing here reaches for V2. A failed attempt returns a failure; deciding what
 * to do about it belongs to the manager, through a button.
 */
export type V3AttemptOutcome =
  | {
      readonly status: "accepted"
      readonly editorState: EditorState
      readonly problem: PlanningProblemV3
      readonly request: SolvePlanningRequest
      readonly response: SolvePlanningResponse
      readonly acceptance: Extract<V3Acceptance, { accepted: true }>
    }
  | {
      readonly status: "rejected"
      /** Present whenever the engine answered at all; absent if it never did. */
      readonly response?: SolvePlanningResponse
      readonly problem?: PlanningProblemV3
      readonly title: string
      readonly message: string
      readonly details: readonly string[]
    }

export interface V3AttemptInput {
  readonly prepared: Extract<PreparedPlanningGeneration, { status: "ready" }>
  readonly regeneration?: PlanningRegenerationRequest
  readonly baseline?: PlanningBaselineV3
  readonly solve?: SolveV3Options
}

export async function runV3Generation(input: V3AttemptInput): Promise<V3AttemptOutcome> {
  const built = buildPlanningProblemV3(input.prepared.generationInput)
  if (!built.ok) {
    // The problem could not even be described. Never a solver failure, and
    // never something a retry fixes.
    return {
      status: "rejected",
      title: "Le problème V3 n'a pas pu être construit",
      message:
        "La configuration actuelle ne se traduit pas en problème V3. Le planning V2 est inchangé.",
      details: built.errors.map((error) => `${error.code} — ${error.message}`),
    }
  }

  const problem = built.problem
  const request = buildSolvePlanningRequest(problem, input.regeneration, input.baseline)
  const response = await solvePlanningV3OverHttp(request, input.solve)
  const acceptance = acceptV3Result(request, response)

  if (!acceptance.accepted) {
    return {
      status: "rejected",
      response,
      problem,
      title: rejectionTitle(response),
      message: acceptance.message,
      details: response.diagnostics.entries
        .filter((entry) => entry.severity === "blocking")
        .map((entry) => `${entry.code} — ${entry.message}`),
    }
  }

  return {
    status: "accepted",
    editorState: editorStateFromV3Solution({
      solution: acceptance.solution,
      coreInput: input.prepared.coreInput,
      configuration: input.prepared.configuration,
      settings: input.prepared.settings,
    }),
    problem,
    request,
    response,
    acceptance,
  }
}

/**
 * A heading that says what actually happened, in the manager's terms.
 *
 * Each outcome gets its own wording because the right next action differs: an
 * outage is worth retrying, a proven impossibility is not, and a refused
 * preservation is fixed by releasing a lock. A single "V3 failed" would send
 * every one of them to the same shrug.
 */
function rejectionTitle(response: SolvePlanningResponse): string {
  switch (response.outcome) {
    case "backend-error":
      return "Le moteur V3 n'a pas pu répondre"
    case "invalid-problem":
      return "Le moteur V3 a refusé la demande"
    case "infeasible":
      return "Aucun planning légal n'existe pour cette semaine en V3"
    case "timeout-without-solution":
      return "Le moteur V3 n'a rien trouvé dans le temps imparti"
    case "cancelled":
      return "Recherche V3 annulée"
    default:
      return "Le résultat V3 a été refusé"
  }
}
