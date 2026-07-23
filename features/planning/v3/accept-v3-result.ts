import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type { PlanningValidationReportV3 } from "@/features/core/planning-v3/types/validation"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

import { checkSolvePlanningResponse } from "@/features/core/planning-contract/invariants"
import { requestedPreservations } from "@/features/core/planning-contract/types/solve-request"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

/**
 * The gate a V3 answer must pass before it may be shown as the active planning.
 *
 * Pure, and run on the CLIENT even though the route handler already validated
 * on the server. That is not paranoia about the network: the two checks answer
 * different questions. The server asks "did my engine behave"; this asks "may I
 * put this in front of a manager and let them publish it". The second is the
 * one that matters here, it is cheap, and the day the transport changes — a
 * cache, a worker, a replay of a stored response — it is the only one still
 * standing between a bad schedule and the screen.
 *
 * Every rejection reason is a REFUSAL TO DISPLAY, never a fallback. Nothing here
 * reaches for V2.
 */

export const V3_REJECTION_REASONS = [
  "outcome-not-publishable",
  "no-solution",
  "contract-violated",
  "wrong-problem",
  "hard-constraints-violated",
  "preservation-not-respected",
] as const
export type V3RejectionReason = (typeof V3_REJECTION_REASONS)[number]

export type V3Acceptance =
  | {
      readonly accepted: true
      readonly solution: PlanningSolutionV3
      readonly report: PlanningValidationReportV3
      /**
       * True when the schedule is legal but carries costs a human must own.
       * Displayable; publishable only after an explicit acceptance.
       */
      readonly requiresExplicitAcceptance: boolean
    }
  | {
      readonly accepted: false
      readonly reason: V3RejectionReason
      readonly message: string
      /** What the validator found, when it is what refused. */
      readonly report?: PlanningValidationReportV3
    }

export function acceptV3Result(
  request: SolvePlanningRequest,
  response: SolvePlanningResponse
): V3Acceptance {
  // 1. The engine's own verdict must be one that carries a schedule at all.
  if (response.outcome !== "optimal" && response.outcome !== "feasible") {
    return {
      accepted: false,
      reason: "outcome-not-publishable",
      message: `Le moteur V3 a répondu « ${response.outcome} » : aucun planning à afficher.`,
    }
  }

  if (response.solution === null) {
    return {
      accepted: false,
      reason: "no-solution",
      message: "Le moteur V3 annonce une solution sans en joindre aucune.",
    }
  }

  // 2. The response must be internally coherent. A response that breaks the
  // contract is an engine defect, and an engine caught defective on the shape
  // of its answer has not earned trust about its content.
  const violations = checkSolvePlanningResponse(response)
  if (violations.length > 0) {
    return {
      accepted: false,
      reason: "contract-violated",
      message: `Réponse V3 non conforme au contrat : ${violations.map((entry) => entry.code).join(", ")}.`,
    }
  }

  // 3. The schedule must answer the problem that was actually asked. Cheap, and
  // the only thing standing between a stale or replayed response and a manager
  // publishing last week's schedule under this week's header.
  const expected = fingerprintProblem(request.problem)
  if (response.solution.problemFingerprint !== expected) {
    return {
      accepted: false,
      reason: "wrong-problem",
      message: `Le planning reçu répond à un autre problème (${response.solution.problemFingerprint} au lieu de ${expected}).`,
    }
  }

  // 4. Re-audited from scratch, here, against the problem this client built.
  const report = validatePlanningSolutionV3(request.problem, response.solution)
  if (!report.validHardConstraints) {
    return {
      accepted: false,
      reason: "hard-constraints-violated",
      message: `Le validateur indépendant rejette ce planning : ${report.violations.length} violation(s) bloquante(s).`,
      report,
    }
  }

  // 5. What the manager asked to protect must actually have been protected.
  const requested = requestedPreservations(request)
  const unmet = response.metadata.unmetPreservations
  if (
    (requested.locks && unmet.includes("locks")) ||
    (requested.manualEdits && unmet.includes("manual-edits"))
  ) {
    return {
      accepted: false,
      reason: "preservation-not-respected",
      message: `Le moteur n'a pas respecté : ${unmet.join(", ")}. Le planning n'est pas celui qui a été demandé.`,
      report,
    }
  }

  return {
    accepted: true,
    solution: response.solution,
    report,
    requiresExplicitAcceptance: report.requiresExplicitAcceptance,
  }
}

/** The one-line label the screen shows for an accepted V3 planning. */
export function describeV3Engine(response: SolvePlanningResponse): string {
  if (response.outcome === "optimal") {
    return "V3 expérimental — optimum démontré"
  }
  return "V3 expérimental — solution faisable, optimalité non prouvée"
}

/**
 * Why a feasible answer is only feasible, for the technical drawer.
 *
 * Kept off the main screen: "the split-shift space is not enumerated" is a true
 * and important caveat, and it is also not something a manager can act on while
 * looking at a week. It belongs where someone goes to ask why.
 */
export function v3TechnicalCaveats(
  response: SolvePlanningResponse,
  problem: PlanningProblemV3
): readonly { readonly label: string; readonly value: string }[] {
  const caveats = [...response.diagnostics.technical]
  if (response.metadata.candidateSpace === "incomplete") {
    caveats.unshift({
      label: "Espace de recherche incomplet",
      value: problem.rules.splitShiftAllowed
        ? "Le secteur autorise les coupures, que ce moteur n'énumère pas : les shifts continus rendus restent légaux, mais aucun optimum global ne peut être annoncé."
        : "L'espace des shifts n'a pas été énuméré entièrement : aucun optimum ne peut être annoncé.",
    })
  }
  return caveats
}
