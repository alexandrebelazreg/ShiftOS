import {
  optimalityForOutcome,
  outcomeForbidsSolution,
  outcomeRequiresSolution,
  SOLVE_PLANNING_OUTCOMES,
  SOLVE_PRESERVATIONS,
  SOLVE_STOP_CAUSES,
} from "@/features/core/planning-contract/types/solve-outcome"
import type { SolvePlanningOutcome } from "@/features/core/planning-contract/types/solve-outcome"
import { isBackendFailureCode } from "@/features/core/planning-contract/types/solve-response"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

/**
 * The rules a response must satisfy, whoever built it — checked, not trusted.
 *
 * A contract made only of TypeScript types constrains the shape of an answer
 * and nothing about its meaning. Nothing in the type system stops an adapter
 * from returning `outcome: "optimal"` with no schedule, or reporting a dead
 * backend as a proven impossibility. Those two mistakes are cheap to make in a
 * `catch` block and expensive downstream: the first crashes a caller that
 * trusted the contract, the second tells a manager their week is impossible
 * when in fact a service was down.
 *
 * So the meaning is enforced here, as pure predicates over a finished response,
 * and adapters run them on their own output before returning it. A broken
 * adapter fails loudly at its own boundary instead of quietly poisoning
 * everything downstream.
 */

export interface SolveContractViolation {
  readonly code: string
  readonly message: string
}

/**
 * Every rule violation found in `response`, or an empty array.
 *
 * Returns them all rather than the first: a hand-built response is usually
 * wrong in several related ways at once, and one-at-a-time fixing hides that.
 */
export function checkSolvePlanningResponse(
  response: SolvePlanningResponse
): readonly SolveContractViolation[] {
  const violations: SolveContractViolation[] = []
  const { outcome, solution, diagnostics, metadata } = response

  const report = (code: string, message: string): void => {
    violations.push({ code, message })
  }

  // ---- Vocabulary ---------------------------------------------------------
  // Checked first: every rule below reads these values, and a rule that
  // silently passes on an unknown string is worse than no rule.
  if (!(SOLVE_PLANNING_OUTCOMES as readonly string[]).includes(outcome)) {
    report("unknown-outcome", `Issue « ${outcome} » hors du vocabulaire normalisé.`)
    return violations
  }
  if (!(SOLVE_STOP_CAUSES as readonly string[]).includes(metadata.stopCause)) {
    report("unknown-stop-cause", `Cause d'arrêt « ${metadata.stopCause} » hors vocabulaire.`)
  }
  for (const preservation of metadata.unmetPreservations) {
    if (!(SOLVE_PRESERVATIONS as readonly string[]).includes(preservation)) {
      report("unknown-preservation", `Préservation « ${preservation} » hors vocabulaire.`)
    }
  }

  // ---- Solution presence --------------------------------------------------
  if (outcomeRequiresSolution(outcome) && solution === null) {
    report(
      "outcome-requires-solution",
      `L'issue « ${outcome} » affirme qu'un planning légal a été trouvé, mais aucun n'est joint.`
    )
  }
  if (outcomeForbidsSolution(outcome) && solution !== null) {
    report(
      "outcome-forbids-solution",
      `L'issue « ${outcome} » ne décrit aucun planning publiable, mais un planning est joint.`
    )
  }

  // ---- Optimality agrees with the outcome ---------------------------------
  const expectedOptimality = optimalityForOutcome(outcome)
  if (metadata.optimality !== expectedOptimality) {
    report(
      "optimality-disagrees-with-outcome",
      `L'issue « ${outcome} » impose l'optimalité « ${expectedOptimality} », or « ${metadata.optimality} » est annoncée.`
    )
  }

  // ---- What `optimal` costs to claim --------------------------------------
  if (outcome === "optimal") {
    if (metadata.candidateSpace !== "complete") {
      report(
        "optimal-requires-complete-space",
        "Un optimum ne peut être annoncé sur un espace de candidats incomplet : c'est au mieux l'optimum d'une question plus petite."
      )
    }
    if (metadata.stopCause !== "exhausted") {
      report(
        "optimal-requires-exhaustive-stop",
        `Un optimum exige un espace épuisé, or la recherche s'est arrêtée sur « ${metadata.stopCause} ».`
      )
    }
    if (metadata.unmetPreservations.length > 0) {
      report(
        "optimal-requires-every-preservation",
        `Un optimum ne peut être annoncé alors que ${metadata.unmetPreservations.join(", ")} n'a pas été respecté : le planning est optimal pour un autre problème que celui demandé.`
      )
    }
  }

  // ---- Declared stops -----------------------------------------------------
  if (outcome === "feasible" && metadata.stopCause === "not-started") {
    report(
      "feasible-requires-explicit-stop-cause",
      "Un planning légal sans optimum doit dire pourquoi la recherche s'est arrêtée là."
    )
  }
  if (metadata.stopCause === "timeout" && solution !== null && outcome !== "feasible") {
    report(
      "timeout-with-solution-must-be-feasible",
      `Une recherche interrompue par le délai qui a trouvé un planning légal est « feasible », pas « ${outcome} ».`
    )
  }
  if (
    outcome === "timeout-without-solution" &&
    metadata.stopCause !== "timeout" &&
    metadata.stopCause !== "state-limit"
  ) {
    report(
      "timeout-without-solution-requires-declared-limit",
      `« timeout-without-solution » exige une limite déclarée, or l'arrêt est « ${metadata.stopCause} ».`
    )
  }
  if (outcome === "cancelled" && metadata.stopCause !== "cancelled") {
    report(
      "cancelled-requires-cancelled-stop",
      `Une annulation exige l'arrêt « cancelled », or « ${metadata.stopCause} » est annoncé.`
    )
  }

  // ---- Nothing turns a run into a statement about the problem --------------
  if (
    outcome === "infeasible" &&
    metadata.stopCause !== "exhausted" &&
    metadata.stopCause !== "not-started"
  ) {
    report(
      "infeasible-requires-proof",
      `« infeasible » affirme qu'aucun planning n'existe ; un arrêt « ${metadata.stopCause} » ne prouve rien.`
    )
  }
  if (outcome === "invalid-problem" && metadata.stopCause !== "not-started") {
    report(
      "invalid-problem-requires-no-search",
      "Un problème malformé n'est pas cherché : l'arrêt doit être « not-started »."
    )
  }
  if (outcome === "backend-error" && metadata.stopCause !== "backend-error") {
    report(
      "backend-error-requires-backend-stop",
      `Une panne moteur doit s'arrêter sur « backend-error », or « ${metadata.stopCause} » est annoncé.`
    )
  }

  const backendFailure = diagnostics.entries.find((entry) => isBackendFailureCode(entry.code))
  if (backendFailure !== undefined && outcome !== "backend-error") {
    // THE rule this whole module exists for. A dead service, a refused contract
    // or a solver caught lying by its own validator says nothing whatsoever
    // about whether the week can be staffed.
    report(
      "backend-failure-must-not-become-a-verdict",
      `Le diagnostic « ${backendFailure.code} » signale une panne moteur ; l'issue ne peut pas être « ${outcome} ».`
    )
  }

  // ---- Diagnostics stay coherent with themselves --------------------------
  if (outcomeForbidsSolution(outcome) && !diagnostics.blocking) {
    report(
      "unpublishable-outcome-requires-blocking-diagnostic",
      `L'issue « ${outcome} » ne rend aucun planning publiable : il faut le dire dans les diagnostics.`
    )
  }
  if (outcomeRequiresSolution(outcome) && diagnostics.blocking) {
    report(
      "publishable-outcome-forbids-blocking-diagnostic",
      `L'issue « ${outcome} » annonce un planning légal, contredit par un diagnostic bloquant.`
    )
  }
  if (diagnostics.blocking !== diagnostics.entries.some((entry) => entry.severity === "blocking")) {
    report(
      "blocking-flag-disagrees-with-entries",
      "Le drapeau bloquant ne correspond pas aux entrées de diagnostic."
    )
  }
  if (
    diagnostics.requiresExplicitAcceptance !==
    diagnostics.entries.some((entry) => entry.requiresExplicitAcceptance)
  ) {
    report(
      "acceptance-flag-disagrees-with-entries",
      "Le drapeau d'acceptation ne correspond pas aux entrées de diagnostic."
    )
  }

  // ---- Unmet promises agree with the booleans that summarise them ---------
  if (metadata.unmetPreservations.includes("locks") === metadata.respectedLocks) {
    report(
      "unmet-locks-disagrees-with-respected-flag",
      "« locks » non tenu et respectedLocks se contredisent."
    )
  }
  if (metadata.unmetPreservations.includes("manual-edits") === metadata.respectedManualEdits) {
    report(
      "unmet-manual-edits-disagrees-with-respected-flag",
      "« manual-edits » non tenu et respectedManualEdits se contredisent."
    )
  }
  if (metadata.unmetPreservations.includes("stability") && metadata.minimizedOtherChanges) {
    report(
      "unmet-stability-disagrees-with-minimized-flag",
      "« stability » non tenu alors que minimizedOtherChanges est vrai."
    )
  }

  return violations
}

export function isValidSolvePlanningResponse(response: SolvePlanningResponse): boolean {
  return checkSolvePlanningResponse(response).length === 0
}

/**
 * Raised when an adapter produced a response that breaks the contract.
 *
 * Always a defect in the adapter, never in the problem or the request — which
 * is why it carries the violations rather than being reported as a diagnostic:
 * a diagnostic is something a manager reads and decides about, and there is
 * nothing here for anyone but a developer to decide.
 */
export class SolveContractViolationError extends Error {
  readonly violations: readonly SolveContractViolation[]

  constructor(violations: readonly SolveContractViolation[]) {
    super(
      `Réponse de planification non conforme au contrat : ${violations
        .map((violation) => `${violation.code} — ${violation.message}`)
        .join(" | ")}`
    )
    this.name = "SolveContractViolationError"
    this.violations = violations
  }
}

/**
 * The guard every adapter runs on its own output before returning it.
 *
 * Placed at the adapter's boundary rather than the caller's on purpose: the
 * adapter is the only party that knows how its engine's vocabulary was
 * translated, so it is the only party whose bug this catches, and it catches it
 * one stack frame from where it was written.
 */
export function assertSolvePlanningResponse(
  response: SolvePlanningResponse
): SolvePlanningResponse {
  const violations = checkSolvePlanningResponse(response)
  if (violations.length > 0) throw new SolveContractViolationError(violations)
  return response
}

/** Outcomes that mean "nothing here may be published". Derived, never listed twice. */
export function isPublishableOutcome(outcome: SolvePlanningOutcome): boolean {
  return outcomeRequiresSolution(outcome)
}
