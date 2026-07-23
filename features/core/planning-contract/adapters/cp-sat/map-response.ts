import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type { PlanningViolationV3 } from "@/features/core/planning-v3/types/validation"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

import {
  assertSolvePlanningResponse,
  SolveContractViolationError,
} from "@/features/core/planning-contract/invariants"
import type {
  SolvePlanningOutcome,
  SolvePreservation,
  SolveStopCause,
} from "@/features/core/planning-contract/types/solve-outcome"
import { optimalityForOutcome } from "@/features/core/planning-contract/types/solve-outcome"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import { requestedPreservations } from "@/features/core/planning-contract/types/solve-request"
import type {
  SolveDiagnostic,
  SolvePlanningResponse,
  SolveTechnicalFact,
} from "@/features/core/planning-contract/types/solve-response"
import type { CpSatResponseEnvelope } from "@/features/core/planning-contract/adapters/cp-sat/protocol"
import { pinnedPreservations } from "@/features/core/planning-contract/adapters/cp-sat/preservation"
import type { PreservationPlan } from "@/features/core/planning-contract/adapters/cp-sat/preservation"

/**
 * CP-SAT's answer, translated into the contract — and audited on the way.
 *
 * Two things happen here that do not happen in the DFS mapper, both because
 * CP-SAT runs in another process. First, the returned schedule is re-validated
 * from scratch by the independent V3A validator: a solver on the far side of a
 * pipe could return anything, including a schedule for a different problem, and
 * "it came back on stdout" is not evidence. Second, every failure of that pipe
 * — a missing interpreter, a truncated write, a version mismatch — is mapped to
 * `backend-error` and can reach no other outcome.
 */

/** What the engine actually delivered of what was asked. */
interface Honoured {
  readonly locks: boolean
  readonly manualEdits: boolean
  readonly stability: boolean
}

const NOTHING_HONOURED: Honoured = { locks: false, manualEdits: false, stability: false }

function unmetOf(request: SolvePlanningRequest, honoured: Honoured): SolvePreservation[] {
  const requested = requestedPreservations(request)
  const unmet: SolvePreservation[] = []
  if (requested.locks && !honoured.locks) unmet.push("locks")
  if (requested.manualEdits && !honoured.manualEdits) unmet.push("manual-edits")
  if (requested.minimizeOtherChanges && !honoured.stability) unmet.push("stability")
  return unmet
}

function compose(
  request: SolvePlanningRequest,
  outcome: SolvePlanningOutcome,
  stopCause: SolveStopCause,
  candidateSpace: "complete" | "incomplete",
  solution: PlanningSolutionV3 | null,
  entries: readonly SolveDiagnostic[],
  technical: readonly SolveTechnicalFact[],
  honoured: Honoured
): SolvePlanningResponse {
  const unmetPreservations = unmetOf(request, honoured)
  return assertSolvePlanningResponse({
    outcome,
    solution,
    diagnostics: {
      blocking: entries.some((entry) => entry.severity === "blocking"),
      requiresExplicitAcceptance: entries.some((entry) => entry.requiresExplicitAcceptance),
      entries,
      technical,
    },
    metadata: {
      engine: "cp-sat",
      respectedLocks: !unmetPreservations.includes("locks"),
      respectedManualEdits: !unmetPreservations.includes("manual-edits"),
      minimizedOtherChanges: requestedPreservations(request).minimizeOtherChanges && honoured.stability,
      unmetPreservations,
      optimality: optimalityForOutcome(outcome),
      candidateSpace,
      stopCause,
    },
  })
}

/**
 * Anything that went wrong with the PROCESS rather than the problem.
 *
 * The only mapper the transport layer may reach, and it has exactly one
 * outcome. A missing Python, an OR-Tools that is not installed, a truncated
 * pipe and a solver caught contradicting its validator are all the same claim:
 * we learned nothing about this week.
 */
export function cpSatBackendError(
  request: SolvePlanningRequest,
  code: string,
  message: string,
  technical: readonly SolveTechnicalFact[] = []
): SolvePlanningResponse {
  return compose(
    request,
    "backend-error",
    "backend-error",
    "incomplete",
    null,
    [{ code, severity: "blocking", message, requiresExplicitAcceptance: false }],
    [{ label: "Moteur", value: "cp-sat" }, ...technical],
    NOTHING_HONOURED
  )
}

/**
 * Local work was submitted for protection with no reference schedule.
 *
 * Refused before the subprocess. A `shiftId` is meaningless without the
 * schedule that minted it, so there is no question here to solve — only a
 * looser one that nobody asked for.
 */
export function cpSatMissingBaseline(request: SolvePlanningRequest): SolvePlanningResponse {
  const regeneration = request.regeneration
  return compose(
    request,
    "invalid-problem",
    "not-started",
    "incomplete",
    null,
    [
      {
        code: "missing-baseline-for-preservations",
        severity: "blocking",
        message: `La requête demande de préserver ${regeneration?.lockedShiftIds.length ?? 0} verrou(s) et ${regeneration?.editedShifts.length ?? 0} retouche(s) sans planning de référence : ces identifiants ne désignent rien, et résoudre sans eux répondrait à une autre question.`,
        requiresExplicitAcceptance: false,
      },
    ],
    [
      { label: "Moteur", value: "cp-sat" },
      { label: "Planning de référence", value: "absent ou vide" },
    ],
    NOTHING_HONOURED
  )
}

/**
 * A demand this adapter cannot turn into a hard constraint.
 *
 * `invalid-problem` rather than a silent correction, and rather than solving
 * without it. Rounding a retouch to the nearest legal geometry — or dropping a
 * lock whose shift has vanished and carrying on — would return a schedule that
 * looks like it honoured a request it did not. The diagnostic carries the id
 * AND the kind, so the caller knows exactly which piece of local work it is
 * being asked about.
 */
export function cpSatUnresolvedPreservations(
  request: SolvePlanningRequest,
  plan: PreservationPlan
): SolvePlanningResponse {
  const entries: SolveDiagnostic[] = plan.unresolved.map((issue) => ({
    code:
      issue.reason === "shift-absent-from-baseline"
        ? "unknown-preserved-shift"
        : `unpreservable-shift:${issue.reason}`,
    severity: "blocking",
    message: `${issue.kind === "lock" ? "Verrou" : "Retouche"} « ${issue.shiftId} » impossible à imposer — ${issue.message}`,
    requiresExplicitAcceptance: false,
  }))
  return compose(
    request,
    "invalid-problem",
    "not-started",
    "incomplete",
    null,
    entries,
    [
      { label: "Moteur", value: "cp-sat" },
      { label: "Préservations refusées", value: String(plan.unresolved.length) },
      ...plan.unresolved.map((issue) => ({
        label: `Préservation ${issue.kind}`,
        value: `${issue.shiftId} — ${issue.reason}`,
      })),
    ],
    NOTHING_HONOURED
  )
}

export function cpSatCancelled(request: SolvePlanningRequest): SolvePlanningResponse {
  return compose(
    request,
    "cancelled",
    "cancelled",
    "incomplete",
    null,
    [
      {
        code: "search-cancelled",
        severity: "blocking",
        message: "Recherche annulée avant toute solution : aucune conclusion sur le problème.",
        requiresExplicitAcceptance: false,
      },
    ],
    [{ label: "Moteur", value: "cp-sat" }],
    NOTHING_HONOURED
  )
}

/**
 * The main translation: one CP-SAT envelope into one contract response.
 */
export function cpSatResponseFromEnvelope(
  request: SolvePlanningRequest,
  plan: PreservationPlan,
  envelope: CpSatResponseEnvelope
): SolvePlanningResponse {
  const problem = request.problem
  const technical = technicalFacts(envelope)

  if (envelope.status === "error") {
    return cpSatBackendError(
      request,
      envelope.error?.code ?? "engine-transport-failure",
      envelope.error?.message ?? "Le moteur a signalé une erreur sans message.",
      technical
    )
  }

  if (envelope.status === "invalid-problem") {
    return compose(
      request,
      "invalid-problem",
      "not-started",
      envelope.candidateSpace,
      null,
      [
        {
          code: envelope.error?.code ?? "model-error",
          severity: "blocking",
          message: envelope.error?.message ?? "Le modèle a refusé le problème.",
          requiresExplicitAcceptance: false,
        },
      ],
      technical,
      NOTHING_HONOURED
    )
  }

  if (envelope.status === "infeasible") {
    // `infeasible` is a claim about the WEEK. It may only be made on a proof,
    // and CP-SAT proves it by exhausting the model — never by running out of
    // time. A protocol that reported the two the same way would be a protocol
    // bug, and it is treated as one rather than believed.
    if (envelope.stopCause !== "exhausted") {
      return cpSatBackendError(
        request,
        "engine-transport-failure",
        `Le moteur annonce une infaisabilité sans l'avoir démontrée (arrêt « ${envelope.stopCause} ») : une infaisabilité non prouvée n'en est pas une.`,
        technical
      )
    }
    return compose(
      request,
      "infeasible",
      "exhausted",
      envelope.candidateSpace,
      null,
      infeasibilityEntries(plan),
      technical,
      NOTHING_HONOURED
    )
  }

  if (envelope.status === "no-solution") {
    return compose(
      request,
      "timeout-without-solution",
      "timeout",
      envelope.candidateSpace,
      null,
      [
        {
          code: "search-stopped-without-solution",
          severity: "blocking",
          message:
            "Le budget de temps a expiré avant toute solution légale : l'infaisabilité n'est PAS démontrée.",
          requiresExplicitAcceptance: false,
        },
      ],
      technical,
      NOTHING_HONOURED
    )
  }

  // ── status === "solved" ────────────────────────────────────────────────
  const fingerprint = fingerprintProblem(problem)
  if (envelope.problemFingerprint !== undefined && envelope.problemFingerprint !== fingerprint) {
    // The far side answered a different question. Nothing about this schedule
    // is trustworthy, including the parts that look right.
    return cpSatBackendError(
      request,
      "engine-transport-failure",
      `Le moteur a résolu un autre problème (${envelope.problemFingerprint} au lieu de ${fingerprint}).`,
      technical
    )
  }

  const solution: PlanningSolutionV3 = {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprint,
    assignments: envelope.assignments,
  }

  // The audit. A solver that never meets its validator grades its own homework,
  // and across a pipe it is not even the same program.
  const report = validatePlanningSolutionV3(problem, solution)
  if (!report.validHardConstraints) {
    return cpSatBackendError(
      request,
      "solver-contradicted-by-validator",
      `CP-SAT a produit un planning que le validateur indépendant rejette (${report.violations.length} violation(s) bloquante(s)) : défaut du moteur, jamais du problème.`,
      [...technical, ...report.violations.slice(0, 5).map((v) => ({ label: v.rule, value: v.message }))]
    )
  }

  if (envelope.unmatchedPreservations.length > 0) {
    // The backstop for anything the pure pre-validation missed. The model could
    // not express a demand, which means it silently solved a LOOSER problem —
    // so the schedule it produced answers a question nobody asked, however
    // legal it looks.
    return compose(
      request,
      "invalid-problem",
      "not-started",
      envelope.candidateSpace,
      null,
      envelope.unmatchedPreservations.map((entry) => ({
        code: `unpreservable-shift:${entry.reason}`,
        severity: "blocking" as const,
        message: `${entry.kind === "lockedAssignments" ? "Verrou" : "Retouche"} « ${entry.shiftId ?? "?"} » inexprimable dans le modèle — ${entry.reason}.`,
        requiresExplicitAcceptance: false,
      })),
      technical,
      NOTHING_HONOURED
    )
  }

  // Everything asked for was pinned before the search began, so a schedule that
  // came back honours all of it. Only stability can fall short here, and only
  // for the one reason that does not stop the request: no reference to measure
  // against.
  const honoured: Honoured = {
    locks: true,
    manualEdits: true,
    stability: plan.minimizeOtherChanges && !plan.stabilityUnmeasurable && envelope.stability !== null,
  }

  const entries: SolveDiagnostic[] = [
    ...report.degradations.map((violation) => fromViolation(violation, "degradation")),
    ...report.informations.map((violation) => fromViolation(violation, "information")),
  ]

  if (plan.minimizeOtherChanges && plan.stabilityUnmeasurable) {
    entries.push({
      code: "stability-without-baseline",
      severity: "degradation",
      message:
        "Stabilité demandée sans planning de référence : il n'y a rien à quoi rester proche, l'objectif n'a pas été posé.",
      requiresExplicitAcceptance: false,
    })
  }

  const allProven = envelope.passes.every((pass) => pass.proven)
  const unmet = unmetOf(request, honoured)
  // Every condition must hold at once. `optimal` here means "proven optimal for
  // the request that was actually made" — a proof over a reduced space, or over
  // a problem missing a lock the manager asked for, is a proof about a
  // different question.
  const outcome: SolvePlanningOutcome =
    allProven &&
    envelope.stopCause === "exhausted" &&
    envelope.candidateSpace === "complete" &&
    unmet.length === 0
      ? "optimal"
      : "feasible"

  return assertNoOmittedPreservation(
    compose(
      request,
      outcome,
      envelope.stopCause === "exhausted" ? "exhausted" : "timeout",
      envelope.candidateSpace,
      solution,
      entries,
      technical,
      honoured
    )
  )
}

/**
 * The preservations a response quietly dropped while still answering.
 *
 * Empty for every response without a schedule: refusing to answer is not
 * dropping anything. Stability is excluded on purpose — it is an objective, not
 * a constraint, and the contract already forbids `optimal` when it goes unmet.
 * Locks and retouches are different in kind: they are the manager's decisions,
 * and a schedule that overrode one is not a worse answer, it is an answer to
 * another question.
 */
export function omittedPreservations(
  response: SolvePlanningResponse
): readonly SolvePreservation[] {
  if (response.solution === null) return []
  return response.metadata.unmetPreservations.filter(
    (preservation) => preservation === "locks" || preservation === "manual-edits"
  )
}

/**
 * The guard that makes this adapter's promise checkable.
 *
 * Throws rather than degrading the outcome, because reaching it is a DEFECT in
 * the mapping above, not a fact about the week — every path that cannot honour
 * a demand is supposed to have returned `invalid-problem` long before here. A
 * silently relaxed CP-SAT answer is the one failure this whole module is built
 * to make impossible, so it fails loudly at the boundary that produced it.
 */
export function assertNoOmittedPreservation(
  response: SolvePlanningResponse
): SolvePlanningResponse {
  const omitted = omittedPreservations(response)
  if (omitted.length > 0) {
    throw new SolveContractViolationError([
      {
        code: "cp-sat-omitted-a-requested-preservation",
        message: `L'adaptateur CP-SAT a rendu « ${response.outcome} » en ayant omis : ${omitted.join(", ")}. Une préservation impossible doit refuser la requête, jamais la relâcher.`,
      },
    ])
  }
  return response
}

/**
 * Why there is no schedule — naming the demands without blaming them.
 *
 * The distinction matters. CP-SAT proved that no schedule satisfies the problem
 * PLUS the pinned preservations; it did not prove which of the two is at fault,
 * and it did not test the problem on its own. Saying "your locks made this
 * impossible" would be a claim the search never made, and would send a manager
 * to undo work that may have been fine.
 */
function infeasibilityEntries(plan: PreservationPlan): readonly SolveDiagnostic[] {
  const pinned = pinnedPreservations(plan)
  if (pinned.length === 0) {
    return [
      {
        code: "proven-infeasible",
        severity: "blocking",
        message:
          "Aucun planning légal n'existe pour ce problème : infaisabilité démontrée par CP-SAT.",
        requiresExplicitAcceptance: false,
      },
    ]
  }

  return [
    {
      code: "proven-infeasible",
      severity: "blocking",
      message: `Aucun planning légal n'existe pour ce problème AVEC les ${pinned.length} préservation(s) imposée(s). CP-SAT a démontré l'infaisabilité de l'ensemble ; il n'a pas déterminé si le problème seul serait résoluble.`,
      requiresExplicitAcceptance: false,
    },
    {
      code: "preservations-participating-in-infeasibility",
      severity: "information",
      // Listed so a manager can try releasing one. Not accused: the search
      // never separated their contribution from the problem's own rigidity.
      message: `Préservations imposées, susceptibles de participer à l'infaisabilité sans en être nécessairement l'unique cause : ${pinned
        .map((entry) => `${entry.kind === "lock" ? "verrou" : "retouche"} « ${entry.shiftId} »`)
        .join(", ")}.`,
      requiresExplicitAcceptance: false,
    },
  ]
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

function technicalFacts(envelope: CpSatResponseEnvelope): readonly SolveTechnicalFact[] {
  const facts: SolveTechnicalFact[] = [
    { label: "Moteur", value: "cp-sat" },
    { label: "Statut du moteur", value: envelope.status },
    { label: "Arrêt annoncé par le moteur", value: envelope.stopCause },
    { label: "Espace de candidats", value: envelope.candidateSpace },
  ]
  // Why the ladder stopped, when it did not run to the end. Shown next to the
  // per-pass facts so "only two passes ran" comes with its reason attached
  // rather than leaving a reader to infer one from the timings.
  if (typeof envelope.stopDetail === "string" && envelope.stopDetail.length > 0) {
    facts.push({ label: "Cause d'arrêt", value: envelope.stopDetail })
  }
  for (const pass of envelope.passes) {
    facts.push({
      label: `Passe ${pass.pass}`,
      value: `${pass.status} · objectif ${pass.objective ?? "—"} · borne ${pass.bestBound ?? "—"} · ${pass.proven ? "prouvé" : "NON prouvé"} · ${pass.seconds}s`,
    })
  }
  if (envelope.stability !== null) {
    const s = envelope.stability
    facts.push({
      label: "Dérive au planning de référence",
      value: `${s.driftMinutes} min · ${s.removedShifts} supprimé(s) · ${s.addedShifts} ajouté(s) · débuts ${s.startShiftMinutes} min · fins ${s.endShiftMinutes} min`,
    })
  }
  if (envelope.model !== undefined) {
    facts.push({ label: "Candidats générés", value: String(envelope.model.candidates ?? "—") })
  }
  for (const [key, value] of Object.entries(envelope.environment ?? {})) {
    facts.push({ label: `Environnement ${key}`, value: String(value) })
  }
  return facts
}

/** Exposed for the adapter: the problem a request describes, fingerprinted. */
export function problemFingerprintOf(problem: PlanningProblemV3): string {
  return fingerprintProblem(problem)
}
