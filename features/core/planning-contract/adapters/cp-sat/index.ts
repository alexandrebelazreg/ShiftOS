import type { EnginePreservationSupport } from "@/features/core/planning-contract/adapters/from-audited-v3"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type {
  PlanningSolveAdapter,
  SolvePlanningResponse,
} from "@/features/core/planning-contract/types/solve-response"

import {
  cpSatBackendError,
  cpSatCancelled,
  cpSatMissingBaseline,
  cpSatResponseFromEnvelope,
  cpSatUnresolvedPreservations,
  problemFingerprintOf,
} from "@/features/core/planning-contract/adapters/cp-sat/map-response"
import { buildPreservationPlan } from "@/features/core/planning-contract/adapters/cp-sat/preservation"
import {
  CP_SAT_PROTOCOL_VERSION,
  parseCpSatResponse,
} from "@/features/core/planning-contract/adapters/cp-sat/protocol"
import type {
  CpSatProfile,
  CpSatRequestEnvelope,
} from "@/features/core/planning-contract/adapters/cp-sat/protocol"
import { createPythonRunner } from "@/features/core/planning-contract/adapters/cp-sat/run-python"
import type { CpSatRunner } from "@/features/core/planning-contract/adapters/cp-sat/run-python"

/**
 * CP-SAT as a `PlanningSolveAdapter`.
 *
 * SERVER-SIDE ONLY, and deliberately not re-exported from the adapters barrel:
 * it reaches `node:child_process`, which cannot be bundled for a browser. A
 * caller has to import this path on purpose, from a server module.
 *
 * NOT wired into the application. No React component, no `PlanningView`, no
 * engine selector reaches it; `CURRENT_PLANNING_ENGINE_VERSION` is still `v2`
 * and nothing here changes that. This sprint makes CP-SAT *conform*, not
 * *active*.
 *
 * The pipeline is four steps, and each one can only fail in one direction:
 *   1. resolve the locks and retouches against the baseline    (pure)
 *   2. refuse the request outright if any of them is unusable  (pure)
 *   3. run the model in a subprocess                           (transport)
 *   4. re-validate the answer independently, then translate    (pure)
 *
 * Step 2 is what makes this adapter's promise worth something: IF it returns a
 * schedule, that schedule honours every preservation it was given. There is no
 * middle path where a lock is dropped and mentioned in a footnote. The demands
 * it cannot express stop the request; the demands it can express become hard
 * constraints, and if that makes the week impossible it says so with a proof.
 *
 * There is no fallback to the DFS prototype at any step. A caller that asked
 * for CP-SAT and silently received a best-effort search would publish a week
 * believing something false about it.
 */

/**
 * The budget and search options behind each profile.
 *
 * Mirrors `CPSAT_PROFILES` in `cpsat_service.py`, which applies the same values
 * when a caller sends a profile and no explicit override. Declared here too so
 * the application can show a manager what it is about to ask for without
 * spawning a process to find out.
 *
 * `workers: 1` in BOTH. Eight workers were measured on the Drive week: 4% of
 * wall time for twice the CPU, and a schedule that differed on every run. The
 * objectives stayed identical, but a planning that changes shape on each click
 * is not worth 4%.
 */
export const CP_SAT_PROFILES: Record<CpSatProfile, { timeoutSeconds: number; workers: number; useHints: boolean }> = {
  // What a manager clicking "Générer" gets. 120 seconds is measured, not picked.
  // On the Drive week, three runs at each budget:
  //   60 s  — pass 1 never proven; 13, 1 and 1 under-covered slots. Legal every
  //           time, reproducible never.
  //   90 s  — pass 1 proves 1 (3/3), but pass 2 does not finish: 180 minutes of
  //           deficit left unoptimised.
  //   120 s — pass 1 proves 1 AND pass 2 proves 60 (3/3). The extra ~30 seconds
  //           buy 120 employee-minutes of coverage.
  fast: { timeoutSeconds: 120, workers: 1, useHints: true },
  // A deliberate deepening, asked for explicitly.
  thorough: { timeoutSeconds: 300, workers: 1, useHints: true },
}

/** No budget may exceed the deep profile's ceiling. */
export const CP_SAT_MAX_TIMEOUT_SECONDS = 300

export interface CpSatAdapterConfig {
  /** Injected for tests: every failure mode has a fake, none needs Python. */
  readonly runner?: CpSatRunner
  readonly pythonExecutable?: string
  readonly scriptPath?: string
  /** Which bundle of budget and search options to run under. */
  readonly profile?: CpSatProfile
  /** Budget handed to CP-SAT for ALL its passes combined. */
  readonly timeoutSeconds?: number
  /**
   * Carry each pass's solution into the next as a hint. Defaults to the
   * profile's value; both profiles enable it.
   */
  readonly useHints?: boolean
  /**
   * Hard kill for the process, beyond the solver's own budget.
   *
   * Strictly larger on purpose: a process killed at exactly its solver budget
   * would report `backend-error` for what is really a clean timeout, and the
   * two must not be confused — one is an outage, the other is a fact about the
   * search.
   */
  readonly processTimeoutMs?: number
  readonly seed?: number
  readonly workers?: number
  readonly signal?: { readonly aborted: boolean }
}

/** What CP-SAT can preserve, now that it does. */
export const CP_SAT_PRESERVATION_SUPPORT: EnginePreservationSupport = {
  locks: true,
  manualEdits: true,
  minimizeOtherChanges: true,
}

export function createCpSatAdapter(config: CpSatAdapterConfig = {}): PlanningSolveAdapter {
  const profile: CpSatProfile = config.profile ?? "fast"
  const defaults = CP_SAT_PROFILES[profile]
  // An explicit budget still wins over the profile's, but nothing may exceed
  // the ceiling: a request for an hour is a request to hold a manager's screen
  // hostage, whatever it claims to be optimising.
  const timeoutSeconds = Math.min(
    config.timeoutSeconds ?? defaults.timeoutSeconds,
    CP_SAT_MAX_TIMEOUT_SECONDS
  )
  const useHints = config.useHints ?? defaults.useHints
  const processTimeoutMs = config.processTimeoutMs ?? Math.round(timeoutSeconds * 1000) + 30_000
  const runner =
    config.runner ??
    createPythonRunner({
      pythonExecutable: config.pythonExecutable,
      scriptPath: config.scriptPath,
    })

  return async (request: SolvePlanningRequest): Promise<SolvePlanningResponse> => {
    if (config.signal?.aborted === true) return cpSatCancelled(request)

    const plan = buildPreservationPlan(request)
    // Both refused BEFORE spawning anything. A demand this adapter cannot turn
    // into a hard constraint makes the request unanswerable; running the solver
    // anyway would only produce a schedule that quietly ignores it, and a
    // schedule that ignores a lock is not a worse answer — it is an answer to a
    // different question.
    if (plan.missingBaseline) return cpSatMissingBaseline(request)
    if (plan.unresolved.length > 0) return cpSatUnresolvedPreservations(request, plan)

    const envelope: CpSatRequestEnvelope = {
      protocolVersion: CP_SAT_PROTOCOL_VERSION,
      requestId: problemFingerprintOf(request.problem),
      problem: request.problem,
      preservation: {
        lockedAssignments: plan.lockedAssignments,
        editedAssignments: plan.editedAssignments,
        baselineAssignments: plan.minimizeOtherChanges ? plan.baselineAssignments : [],
        minimizeOtherChanges: plan.minimizeOtherChanges,
      },
      options: {
        profile,
        timeoutSeconds,
        seed: config.seed ?? 1,
        workers: config.workers ?? defaults.workers,
        useHints,
      },
    }

    let outcome
    try {
      outcome = await runner(JSON.stringify(envelope), {
        timeoutMs: processTimeoutMs,
        signal: config.signal,
      })
    } catch (error) {
      // A runner that throws is still a transport failure, never a verdict.
      return cpSatBackendError(
        request,
        "engine-transport-failure",
        error instanceof Error ? error.message : String(error)
      )
    }

    if (outcome.kind === "cancelled") return cpSatCancelled(request)
    if (outcome.kind === "failure") {
      // Every transport failure reports under the SAME diagnostic code. The
      // specific cause travels in the message: `BACKEND_FAILURE_DIAGNOSTIC_CODES`
      // is what the contract invariants key off, and no caller should ever be
      // tempted to branch differently on "Python is missing" than on "the pipe
      // broke" — both mean the same thing to a manager.
      return cpSatBackendError(
        request,
        "engine-transport-failure",
        `${outcome.code} — ${outcome.message}`
      )
    }

    const parsed = parseCpSatResponse(outcome.stdout)
    if (!parsed.ok) {
      return cpSatBackendError(request, "engine-transport-failure", `${parsed.code} — ${parsed.message}`)
    }

    return cpSatResponseFromEnvelope(request, plan, parsed.envelope)
  }
}

export {
  buildPreservationPlan,
  pinnedPreservations,
} from "@/features/core/planning-contract/adapters/cp-sat/preservation"
export type {
  PreservationIssue,
  PreservationIssueReason,
  PreservationKind,
  PreservationPlan,
} from "@/features/core/planning-contract/adapters/cp-sat/preservation"
export {
  assertNoOmittedPreservation,
  omittedPreservations,
} from "@/features/core/planning-contract/adapters/cp-sat/map-response"
export {
  CP_SAT_PROTOCOL_VERSION,
  parseCpSatResponse,
} from "@/features/core/planning-contract/adapters/cp-sat/protocol"
export type {
  CpSatRequestEnvelope,
  CpSatResponseEnvelope,
} from "@/features/core/planning-contract/adapters/cp-sat/protocol"
export { createPythonRunner, defaultCpSatScriptPath } from "@/features/core/planning-contract/adapters/cp-sat/run-python"
export type { CpSatRunner, CpSatRunOutcome } from "@/features/core/planning-contract/adapters/cp-sat/run-python"
