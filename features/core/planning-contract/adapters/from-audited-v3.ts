import type { AuditedSolutionV3 } from "@/features/core/planning-v3/types/audited-solution"
import type { PlanningViolationV3 } from "@/features/core/planning-v3/types/validation"

import { assertSolvePlanningResponse } from "@/features/core/planning-contract/invariants"
import type {
  SolveCandidateSpace,
  SolvePlanningOutcome,
  SolvePreservation,
  SolveStopCause,
} from "@/features/core/planning-contract/types/solve-outcome"
import {
  optimalityForOutcome,
  outcomeOfEngineFailure,
} from "@/features/core/planning-contract/types/solve-outcome"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import { requestedPreservations } from "@/features/core/planning-contract/types/solve-request"
import type {
  SolveDiagnostic,
  SolvePlanningEngine,
  SolvePlanningResponse,
  SolveTechnicalFact,
} from "@/features/core/planning-contract/types/solve-response"

/**
 * Translate a V3 solve-and-audit outcome into the engine-neutral response.
 *
 * This is the seam. Everything a V3 engine says about itself — statuses,
 * proofs, rule codes, search statistics — stops here and comes out the other
 * side as an outcome, a severity and an acceptance. It is the reason a
 * component can render the answer without ever learning that a depth-first
 * search produced it.
 *
 * The translation is checked against the contract invariants before it is
 * returned, so a mistake made here fails at this boundary rather than reaching
 * a caller that trusted the answer.
 */

/**
 * What an engine is actually CAPABLE of preserving.
 *
 * Stated by the adapter, per engine, and never inferred. The DFS prototype
 * declares `false` everywhere because it solves the problem from scratch and
 * has no notion of a pinned shift; a CP-SAT adapter that pins locks as hard
 * constraints will declare `locks: true` and the same mapper will report it.
 */
export interface EnginePreservationSupport {
  readonly locks: boolean
  readonly manualEdits: boolean
  readonly minimizeOtherChanges: boolean
}

export function toSolvePlanningResponse(
  engine: SolvePlanningEngine,
  request: SolvePlanningRequest,
  audited: AuditedSolutionV3,
  support: EnginePreservationSupport
): SolvePlanningResponse {
  const { result, report } = audited
  const requested = requestedPreservations(request)

  const unmetPreservations: SolvePreservation[] = []
  if (requested.locks && !support.locks) unmetPreservations.push("locks")
  if (requested.manualEdits && !support.manualEdits) unmetPreservations.push("manual-edits")
  if (requested.minimizeOtherChanges && !support.minimizeOtherChanges) {
    unmetPreservations.push("stability")
  }

  const candidateSpace: SolveCandidateSpace =
    result.proof.candidateSpace === "complete" ? "complete" : "incomplete"
  const stopCause = audited.solverContradictedByValidator
    ? "backend-error"
    : normalizeStopCause(result.proof.stopCause)
  const outcome = outcomeOf(audited, unmetPreservations, candidateSpace, stopCause)
  const solution = outcome === "optimal" || outcome === "feasible" ? result.solution : null

  const entries: SolveDiagnostic[] = [
    ...(report?.violations ?? []).map((violation) => fromViolation(violation, "blocking")),
    ...(report?.degradations ?? []).map((violation) => fromViolation(violation, "degradation")),
    ...(report?.informations ?? []).map((violation) => fromViolation(violation, "information")),
  ]

  for (const infeasibility of result.diagnostics) {
    entries.push({
      code: infeasibility.code,
      // A reason reported alongside NO answer is why there is none; the same
      // reason next to a schedule is a caveat about it, not a blocker.
      severity: solution === null ? "blocking" : "information",
      message: infeasibility.message,
      requiresExplicitAcceptance: false,
      ...(infeasibility.employeeId !== undefined ? { employeeId: infeasibility.employeeId } : {}),
      ...(infeasibility.date !== undefined ? { date: infeasibility.date } : {}),
    })
  }

  if (audited.solverContradictedByValidator) {
    entries.push({
      code: "solver-contradicted-by-validator",
      severity: "blocking",
      message:
        "Le moteur a produit un planning que le validateur indépendant rejette : défaut du moteur, jamais du problème.",
      requiresExplicitAcceptance: false,
    })
  }

  // Every outcome that carries no schedule must say so in the diagnostics, and
  // a search cut short by a declared limit reports nothing on its own — the V3
  // solver has no violation to report when it simply ran out of budget.
  if (solution === null && !entries.some((entry) => entry.severity === "blocking")) {
    entries.push({
      code: "search-stopped-without-solution",
      severity: "blocking",
      message: stopCauseMessage(outcome, stopCause),
      requiresExplicitAcceptance: false,
    })
  }

  if (unmetPreservations.includes("locks")) {
    entries.push({
      code: "locks-not-supported-by-engine",
      severity: "degradation",
      // Not blocking: the schedule is legal. But losing pinned work is a cost a
      // human owns, so it may not be published without being seen.
      message: `Ce moteur ne sait pas préserver les verrous : les ${request.regeneration?.lockedShiftIds.length ?? 0} shift(s) épinglé(s) ont pu être déplacés.`,
      requiresExplicitAcceptance: solution !== null,
    })
  }

  if (unmetPreservations.includes("manual-edits")) {
    entries.push({
      code: "manual-edits-not-supported-by-engine",
      severity: "degradation",
      message: `Ce moteur ne sait pas préserver les modifications manuelles : les ${request.regeneration?.editedShifts.length ?? 0} retouche(s) ont pu être perdues.`,
      requiresExplicitAcceptance: solution !== null,
    })
  }

  if (unmetPreservations.includes("stability")) {
    entries.push({
      code: "stability-not-supported-by-engine",
      severity: "degradation",
      // Informative rather than a decision: nothing the manager did is lost,
      // the rest of the week simply moves more than they asked it to.
      message:
        "Ce moteur n'optimise pas la stabilité : le reste de la semaine a pu changer plus que demandé.",
      requiresExplicitAcceptance: false,
    })
  }

  return assertSolvePlanningResponse({
    outcome,
    solution,
    diagnostics: {
      blocking: entries.some((entry) => entry.severity === "blocking"),
      requiresExplicitAcceptance: entries.some((entry) => entry.requiresExplicitAcceptance),
      entries,
      technical: technicalFacts(audited, stopCause),
    },
    metadata: {
      engine,
      respectedLocks: !unmetPreservations.includes("locks"),
      respectedManualEdits: !unmetPreservations.includes("manual-edits"),
      minimizedOtherChanges: requested.minimizeOtherChanges && support.minimizeOtherChanges,
      unmetPreservations,
      optimality: optimalityForOutcome(outcome),
      candidateSpace,
      stopCause,
    },
  })
}

/**
 * The normalized outcome of one audited V3 run.
 *
 * Reads top-down, most damning first: a solver its own validator caught is a
 * defect and says nothing about the problem; a malformed problem was never
 * searched; no schedule means the reason it stopped decides what may be
 * claimed; and a schedule is only ever `optimal` when every condition holds at
 * once — proven exhaustion, a complete space, and a request whose demands were
 * all honoured. Anything short of all three is `feasible`, which is a real
 * answer rather than a downgraded one.
 */
function outcomeOf(
  audited: AuditedSolutionV3,
  unmetPreservations: readonly SolvePreservation[],
  candidateSpace: SolveCandidateSpace,
  stopCause: SolveStopCause
): SolvePlanningOutcome {
  if (audited.solverContradictedByValidator) {
    return outcomeOfEngineFailure("engine-contradicted-by-validator")
  }

  const { result } = audited
  if (result.status === "invalid-problem") return outcomeOfEngineFailure("malformed-problem")

  if (result.solution === null) {
    if (stopCause === "cancelled") return outcomeOfEngineFailure("cancelled")
    if (stopCause === "timeout") return outcomeOfEngineFailure("timeout")
    if (stopCause === "state-limit") return outcomeOfEngineFailure("state-limit")
    return outcomeOfEngineFailure(
      stopCause === "exhausted" ? "exhausted-without-solution" : "proven-infeasible"
    )
  }

  const proven =
    result.status === "optimal" &&
    stopCause === "exhausted" &&
    candidateSpace === "complete" &&
    unmetPreservations.length === 0
  return proven ? "optimal" : "feasible"
}

/**
 * The V3 proof's free-form stop cause, mapped onto the normalized vocabulary.
 *
 * `invalid-problem` and `structurally-infeasible` both mean the run stopped
 * before searching anything, which is exactly what `not-started` says. An
 * unrecognised cause maps there too: claiming a declared limit that was never
 * declared would be worse than admitting the run never really began, and the
 * `feasible-requires-explicit-stop-cause` invariant turns any such gap into a
 * loud failure at the adapter boundary instead of a quiet one downstream.
 */
function normalizeStopCause(raw: string | undefined): SolveStopCause {
  switch (raw) {
    case "exhausted":
    case "timeout":
    case "state-limit":
    case "cancelled":
      return raw
    default:
      return "not-started"
  }
}

function stopCauseMessage(outcome: SolvePlanningOutcome, stopCause: SolveStopCause): string {
  if (outcome === "cancelled") {
    return "Recherche annulée avant d'avoir trouvé un planning légal : aucune conclusion sur le problème."
  }
  return `Recherche interrompue (${stopCause}) avant tout planning légal : l'infaisabilité n'est PAS démontrée.`
}

function fromViolation(
  violation: PlanningViolationV3,
  severity: SolveDiagnostic["severity"]
): SolveDiagnostic {
  return {
    code: violation.rule,
    severity,
    message: violation.message,
    requiresExplicitAcceptance: violation.requiresExplicitAcceptance === true,
    ...(violation.employeeId !== undefined ? { employeeId: violation.employeeId } : {}),
    ...(violation.date !== undefined ? { date: violation.date } : {}),
    ...(violation.expected !== undefined ? { expected: violation.expected } : {}),
    ...(violation.actual !== undefined ? { actual: violation.actual } : {}),
  }
}

/** Engine internals, worded once here so the technical panel just lists them. */
function technicalFacts(
  audited: AuditedSolutionV3,
  stopCause: SolveStopCause
): readonly SolveTechnicalFact[] {
  const { result, report } = audited
  const facts: SolveTechnicalFact[] = [
    { label: "Statut du moteur", value: result.status },
    { label: "Preuve", value: result.proof.kind },
    { label: "Arrêt normalisé", value: stopCause },
    { label: "Arrêt annoncé par le moteur", value: result.proof.stopCause ?? "non renseigné" },
    { label: "Espace de candidats", value: result.proof.candidateSpace ?? "non renseigné" },
    { label: "Candidats générés", value: String(result.statistics.candidatesGenerated) },
    { label: "États explorés", value: String(result.statistics.weeklyStatesEvaluated) },
    { label: "Durée", value: `${result.statistics.durationMs} ms` },
  ]

  if (result.objective !== null) {
    facts.push({ label: "Objectif lexicographique", value: result.objective.join(" · ") })
  }
  if (report !== null) {
    facts.push({ label: "Empreinte de la solution", value: report.fingerprint })
    facts.push({ label: "Créneaux sous-couverts", value: String(report.underCoveredSlots) })
  }

  return facts
}
