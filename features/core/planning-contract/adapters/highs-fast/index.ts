import { createPythonRunner } from "@/features/core/planning-contract/adapters/cp-sat/run-python"
import type { CpSatRunner } from "@/features/core/planning-contract/adapters/cp-sat/run-python"
import type { EnginePreservationSupport } from "@/features/core/planning-contract/adapters/from-audited-v3"
import { toSolvePlanningResponse } from "@/features/core/planning-contract/adapters/from-audited-v3"
import { toBackendErrorResponse } from "@/features/core/planning-contract/errors"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type {
  PlanningSolveAdapter,
  SolvePlanningResponse,
  SolveTechnicalFact,
} from "@/features/core/planning-contract/types/solve-response"
import type { AuditedSolutionV3 } from "@/features/core/planning-v3/orchestrator/solve-and-validate"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type {
  PlanningSolverResultV3,
  PlanningSolverStatusV3,
} from "@/features/core/planning-v3/types/solver"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

import {
  HIGHS_FAST_PROTOCOL_VERSION,
  parseHighsFastResponse,
} from "@/features/core/planning-contract/adapters/highs-fast/protocol"
import type {
  HighsFastRequestEnvelope,
  HighsFastResponseEnvelope,
} from "@/features/core/planning-contract/adapters/highs-fast/protocol"

/**
 * `v3-highs-fast`, behind the neutral contract.
 *
 * A decomposed MILP engine: it settles the weekly roles first, then asks one
 * small allocation model per skeleton, then places exactly. On the canonical
 * Drive week it reaches zero shortfall in about twelve seconds, where the
 * global HiGHS engine needs more than two hundred — and a fifty-nine scenario
 * perturbation campaign found no illegal schedule and no false impossibility.
 *
 * It reaches Python the same way CP-SAT does, through the subprocess runner
 * that already exists. The runner is reused rather than copied: it knows how to
 * kill a hung process, how to distinguish a missing interpreter from a crash,
 * and how to propagate an abort — three things worth getting right once.
 *
 * What it cannot do
 * -----------------
 * It solves from scratch every time. It cannot pin a shift, cannot keep a
 * manual move, and does not optimise for stability against a previous
 * schedule. `HIGHS_FAST_PRESERVATION_SUPPORT` states that plainly, and the
 * mapper turns it into unmet preservations a manager can see rather than a
 * silent unlock — a schedule that ignores a lock is not a worse answer, it is
 * an answer to a different question.
 *
 * And it never claims a proof about a SCHEDULE. Two heuristic choices — which
 * skeletons to rank, which allocation each one gets — sit upstream of the only
 * exact step, so `proof.kind` is `"feasible"` at best and this adapter never
 * upgrades it. An impossibility is the opposite case and is reported as such,
 * because the demand model and the allocation MILP each prove theirs outright.
 */
export const HIGHS_FAST_PRESERVATION_SUPPORT: EnginePreservationSupport = {
  locks: false,
  manualEdits: false,
  minimizeOtherChanges: false,
}

/** Matches the ceiling `highs_service.py` clamps to on the other side. */
export const HIGHS_FAST_MAX_TIMEOUT_SECONDS = 90

/** The everyday budget. Measured worst case across the campaign: 62 seconds. */
export const HIGHS_FAST_DEFAULT_TIMEOUT_SECONDS = 60

export interface HighsFastAdapterConfig {
  /** Injected for tests: every failure mode has a fake, none needs Python. */
  readonly runner?: CpSatRunner
  readonly pythonExecutable?: string
  readonly scriptPath?: string
  readonly timeoutSeconds?: number
  /**
   * Hard kill for the process, beyond the solver's own budget.
   *
   * Strictly larger on purpose: a process killed at exactly its solver budget
   * would report a transport failure for what is really a clean timeout, and
   * the two must not be confused — one is an outage, the other is a fact about
   * the search.
   */
  readonly processTimeoutMs?: number
  readonly signal?: { readonly aborted: boolean }
}

/** The experimental script, resolved from the repository root. */
export function defaultHighsFastScriptPath(): string {
  // Built with the same join the CP-SAT runner uses, and kept here rather than
  // imported so the two engines can move independently.
  return ["experiments", "planning-v3-highs", "highs_service.py"].join("/")
}

export function createHighsFastAdapter(
  config: HighsFastAdapterConfig = {}
): PlanningSolveAdapter {
  const timeoutSeconds = Math.min(
    config.timeoutSeconds ?? HIGHS_FAST_DEFAULT_TIMEOUT_SECONDS,
    HIGHS_FAST_MAX_TIMEOUT_SECONDS
  )
  const processTimeoutMs = config.processTimeoutMs ?? Math.round(timeoutSeconds * 1000) + 30_000
  const runner =
    config.runner ??
    createPythonRunner({
      pythonExecutable: config.pythonExecutable,
      scriptPath: config.scriptPath ?? resolveScriptPath(),
      cwd: resolveWorkingDirectory(),
    })

  return async (request: SolvePlanningRequest): Promise<SolvePlanningResponse> => {
    if (config.signal?.aborted === true) {
      return failure(request, "engine-cancelled", "Résolution annulée avant le lancement.")
    }

    const envelope: HighsFastRequestEnvelope = {
      protocolVersion: HIGHS_FAST_PROTOCOL_VERSION,
      requestId: fingerprintProblem(request.problem),
      problem: request.problem,
      options: { timeoutSeconds },
    }

    let outcome
    try {
      outcome = await runner(JSON.stringify(envelope), {
        timeoutMs: processTimeoutMs,
        signal: config.signal,
      })
    } catch (error) {
      // A runner that throws is still a transport failure, never a verdict.
      return failure(
        request,
        "engine-transport-failure",
        error instanceof Error ? error.message : String(error)
      )
    }

    if (outcome.kind === "cancelled") {
      return failure(request, "engine-cancelled", "Résolution annulée.")
    }
    if (outcome.kind === "failure") {
      // Every transport failure reports under the SAME diagnostic code. The
      // specific cause travels in the message: no caller should branch
      // differently on "Python is missing" than on "the pipe broke" — both mean
      // the same thing to a manager.
      return failure(request, "engine-transport-failure", `${outcome.code} — ${outcome.message}`)
    }

    const parsed = parseHighsFastResponse(outcome.stdout)
    if (!parsed.ok) {
      return failure(request, "engine-transport-failure", `${parsed.code} — ${parsed.message}`)
    }

    return fromEnvelope(request, parsed.envelope)
  }
}

function fromEnvelope(
  request: SolvePlanningRequest,
  envelope: HighsFastResponseEnvelope
): SolvePlanningResponse {
  if (envelope.status === "error") {
    return failure(
      request,
      "engine-transport-failure",
      `${envelope.error?.code ?? "unknown"} — ${envelope.error?.message ?? ""}`
    )
  }

  const audited = auditEnvelope(request, envelope)
  const response = toSolvePlanningResponse(
    "highs-fast",
    request,
    audited,
    HIGHS_FAST_PRESERVATION_SUPPORT
  )
  return {
    ...response,
    diagnostics: {
      ...response.diagnostics,
      technical: [...response.diagnostics.technical, ...technicalFacts(envelope)],
    },
  }
}

/**
 * Re-check the Python answer with the TypeScript validator, always.
 *
 * A Python schedule is never accepted on its own word. `shiftos_highs.evaluate`
 * is a second implementation of the rules and a second implementation can be
 * wrong in the same way as the first, so the one authority on what "legal"
 * means in ShiftOS gets the final say — and a disagreement surfaces as
 * `solverContradictedByValidator`, which the contract turns into a refusal
 * rather than into a schedule.
 */
function auditEnvelope(
  request: SolvePlanningRequest,
  envelope: HighsFastResponseEnvelope
): AuditedSolutionV3 {
  const status: PlanningSolverStatusV3 =
    envelope.status === "solved"
      ? "feasible-timeout"
      : envelope.status === "infeasible"
        ? "infeasible"
        : envelope.status === "invalid-problem"
          ? "invalid-problem"
          : "feasible-timeout"

  if (envelope.status !== "solved") {
    return {
      result: emptyResult(status, envelope),
      report: null,
      solverContradictedByValidator: false,
    }
  }

  const solution: PlanningSolutionV3 = {
    version: request.problem.version,
    problemFingerprint: fingerprintProblem(request.problem),
    assignments: envelope.assignments,
  }
  const report = validatePlanningSolutionV3(request.problem, solution)

  return {
    result: {
      // NEVER `optimal`. The status is deliberately `feasible-timeout` even when
      // the engine stopped early with nothing missing: it stopped because it
      // reached zero, not because it exhausted anything, and the difference is
      // exactly what `optimal` would misstate.
      status: "feasible-timeout",
      solution,
      objective: [report.underCoveredSlots, report.metrics.totalDeficitMinutes],
      proof: {
        kind: "feasible",
        objectiveValues: [report.underCoveredSlots, report.metrics.totalDeficitMinutes],
        note: "Moteur décomposé : squelettes puis allocation conditionnée. Aucune optimalité démontrée.",
        candidateSpace: "incomplete",
        // The contract has four words for why a search ended, and neither of
        // this engine's two endings is `exhausted` — it never explores the whole
        // space, by construction.
        //
        // `state-limit` when it reached zero: it stopped on its OWN declared
        // rule, having walked a deliberately bounded set of skeletons and
        // allocations. Nothing is better than a legal week with nothing
        // missing, so it stops, and calling that a timeout would blame a clock
        // that had time left.
        //
        // `timeout` when it did not: the budget is what ended the search, and
        // a longer one might have found more.
        stopCause:
          envelope.diagnostics.engineStatus === "feasible-zero-deficit"
            ? "state-limit"
            : "timeout",
        deterministic: true,
        durationMs: Math.round((numberOf(envelope.diagnostics.totalSeconds) ?? 0) * 1000),
      },
      statistics: emptyStatistics(envelope),
      diagnostics: [],
    },
    report,
    solverContradictedByValidator: !report.validHardConstraints,
  }
}

function emptyResult(
  status: PlanningSolverStatusV3,
  envelope: HighsFastResponseEnvelope
): PlanningSolverResultV3 {
  return {
    status,
    solution: null,
    objective: null,
    proof: {
      kind: "none",
      objectiveValues: [],
      note:
        envelope.status === "infeasible"
          ? "Impossibilité démontrée : aucune allocation ne satisfait contrats et budgets, ou un plancher dur dépasse la capacité."
          : "Aucun planning trouvé dans le voisinage exploré. Ceci ne démontre rien sur la semaine.",
      candidateSpace: "incomplete",
      stopCause: envelope.status === "infeasible" ? "exhausted" : "timeout",
      deterministic: true,
    },
    statistics: emptyStatistics(envelope),
    diagnostics: [],
  }
}

function emptyStatistics(envelope: HighsFastResponseEnvelope) {
  return {
    candidatesGenerated: numberOf(envelope.diagnostics.shiftsGenerated) ?? 0,
    dailyPatternsEvaluated: numberOf(envelope.diagnostics.skeletonsGenerated) ?? 0,
    weeklyStatesEvaluated: numberOf(envelope.diagnostics.uniqueAllocations) ?? 0,
    branchesPrunedByBound: 0,
    branchesPrunedByFeasibility: numberOf(envelope.diagnostics.placementsInfeasible) ?? 0,
    durationMs: Math.round((numberOf(envelope.diagnostics.totalSeconds) ?? 0) * 1000),
    peakOpenNodes: 0,
  }
}

/**
 * The engine internals a support log needs, already worded.
 *
 * Kept in `technical` rather than in `entries`: none of it asks a manager for a
 * decision, and a diagnostic that requires no decision must never appear where
 * the ones that do are read.
 */
function technicalFacts(envelope: HighsFastResponseEnvelope): SolveTechnicalFact[] {
  const facts: SolveTechnicalFact[] = [
    { label: "Moteur", value: "HiGHS décomposé (Python, sous-processus)" },
    { label: "Verdict moteur", value: String(envelope.diagnostics.engineStatus ?? "inconnu") },
  ]
  const push = (label: string, raw: unknown, suffix = ""): void => {
    const value = numberOf(raw)
    if (value !== null) facts.push({ label, value: `${value}${suffix}` })
  }
  push("Temps total", envelope.diagnostics.totalSeconds, " s")
  push("Squelettes générés", envelope.diagnostics.skeletonsGenerated)
  push("MILP d'allocation résolus", envelope.diagnostics.skeletonAllocationsSolved)
  push("Créneaux sous-couverts", envelope.diagnostics.referenceShortSlots)
  push("Minutes manquantes", envelope.diagnostics.referenceDeficitMinutes)
  if (envelope.diagnostics.usedAllocationFirstFallback === true) {
    facts.push({ label: "Complément", value: "ordre allocation → squelette" })
  }
  const python = envelope.environment.python
  if (typeof python === "string") facts.push({ label: "Python", value: python })
  return facts
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function failure(
  request: SolvePlanningRequest,
  code: string,
  message: string
): SolvePlanningResponse {
  return toBackendErrorResponse("highs-fast", new Error(`${code} — ${message}`), request)
}

function resolveScriptPath(): string {
  return `${process.cwd()}/${defaultHighsFastScriptPath()}`
}

function resolveWorkingDirectory(): string {
  return `${process.cwd()}/experiments/planning-v3-highs`
}

export {
  HIGHS_FAST_PROTOCOL_VERSION,
  parseHighsFastResponse,
} from "@/features/core/planning-contract/adapters/highs-fast/protocol"
export type {
  HighsFastRequestEnvelope,
  HighsFastResponseEnvelope,
} from "@/features/core/planning-contract/adapters/highs-fast/protocol"
