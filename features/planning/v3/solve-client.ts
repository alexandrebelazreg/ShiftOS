import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

import {
  PLANNING_V3_DEFAULT_PROFILE,
  PLANNING_V3_ENDPOINT_PATH,
  PLANNING_V3_ENDPOINT_VERSION,
} from "@/features/planning/v3/solve-endpoint-contract"
import type {
  PlanningV3Engine,
  PlanningV3Profile,
} from "@/features/planning/v3/solve-endpoint-contract"

/**
 * The browser's side of the V3 boundary.
 *
 * It speaks JSON to a route handler and nothing else. It imports no adapter, no
 * `node:` module and no solver — that is the whole reason the boundary exists,
 * and an import-boundary test asserts it rather than trusting this comment.
 *
 * A transport failure comes back as a `backend-error` RESPONSE rather than a
 * thrown error, so every caller handles one shape. What it never comes back as
 * is an infeasibility: a dead route says nothing about whether the week can be
 * staffed.
 */

export type PlanningV3Fetch = (
  input: string,
  init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string; readonly signal?: AbortSignal }
) => Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }>

export interface SolveV3Options {
  /** Which budget/search bundle to run under. Defaults to `fast`. */
  readonly profile?: PlanningV3Profile
  /**
   * Which engine to ask for. Omitted means CP-SAT — the engine this endpoint
   * has always run, so an existing caller's behaviour is untouched.
   */
  readonly engine?: PlanningV3Engine
  readonly timeoutSeconds?: number
  readonly signal?: AbortSignal
  /** Injected in tests; the real one is the platform `fetch`. */
  readonly fetchImpl?: PlanningV3Fetch
  readonly endpointPath?: string
}

export async function solvePlanningV3OverHttp(
  request: SolvePlanningRequest,
  options: SolveV3Options = {}
): Promise<SolvePlanningResponse> {
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as PlanningV3Fetch)
  const path = options.endpointPath ?? PLANNING_V3_ENDPOINT_PATH

  // The budget travels as a PROFILE, not a number, unless the caller insists on
  // one. Sending the profile keeps the two budgets defined in a single place
  // instead of being re-stated — and drifting — at every call site.
  const body = JSON.stringify({
    endpointVersion: PLANNING_V3_ENDPOINT_VERSION,
    problem: request.problem,
    ...(request.regeneration !== undefined ? { regeneration: request.regeneration } : {}),
    ...(request.baseline !== undefined ? { baseline: request.baseline } : {}),
    profile: options.profile ?? PLANNING_V3_DEFAULT_PROFILE,
    ...(options.engine !== undefined ? { engine: options.engine } : {}),
    ...(options.timeoutSeconds !== undefined ? { timeoutSeconds: options.timeoutSeconds } : {}),
  })

  let raw: string
  let ok: boolean
  let status: number
  try {
    const response = await doFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })
    ok = response.ok
    status = response.status
    raw = await response.text()
  } catch (error) {
    return transportFailure(
      request,
      `Le service V3 est injoignable : ${error instanceof Error ? error.message : String(error)}`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return transportFailure(
      request,
      `Réponse illisible du service V3 (HTTP ${status}) : ${raw.slice(0, 200)}`
    )
  }

  if (!isSolveResponse(parsed)) {
    // Includes every non-2xx the route emits for a refused request: those carry
    // a reason, but not a schedule, and the caller must not read one into them.
    return transportFailure(
      request,
      `Réponse hors contrat du service V3 (HTTP ${status}) : ${describe(parsed)}`
    )
  }

  void ok
  return parsed
}

function isSolveResponse(value: unknown): value is SolvePlanningResponse {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.outcome === "string" &&
    "solution" in candidate &&
    typeof candidate.diagnostics === "object" &&
    candidate.diagnostics !== null &&
    typeof candidate.metadata === "object" &&
    candidate.metadata !== null
  )
}

/**
 * A refusal, described so the CODE survives.
 *
 * The route answers a rejected request with `{code, message}`. The message is
 * for a human; the code is the part that says which rule was broken, and it is
 * what anyone debugging reads first — so it goes in even when a message exists.
 */
function describe(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>
    const code = typeof candidate.code === "string" ? candidate.code : null
    const message = typeof candidate.message === "string" ? candidate.message : null
    if (code !== null && message !== null) return `${code} — ${message}`
    if (code !== null) return code
    if (message !== null) return message
  }
  return JSON.stringify(value).slice(0, 200)
}

/**
 * A network failure, in the contract's own vocabulary.
 *
 * Built here rather than imported from `toBackendErrorResponse` because that
 * helper lives beside the adapters; this module must stay importable from a
 * client bundle. The outcome is hard-coded to `backend-error` for the same
 * reason it is derived there: nothing about a broken pipe is a fact about the
 * week.
 */
function transportFailure(
  request: SolvePlanningRequest,
  message: string
): SolvePlanningResponse {
  const regeneration = request.regeneration
  const unmetPreservations = [
    ...(regeneration?.preserveLockedShifts && regeneration.lockedShiftIds.length > 0
      ? (["locks"] as const)
      : []),
    ...(regeneration?.preserveManualEdits && regeneration.editedShifts.length > 0
      ? (["manual-edits"] as const)
      : []),
    ...(regeneration?.minimizeOtherChanges ? (["stability"] as const) : []),
  ]

  return {
    outcome: "backend-error",
    solution: null,
    diagnostics: {
      blocking: true,
      requiresExplicitAcceptance: false,
      entries: [
        {
          code: "engine-transport-failure",
          severity: "blocking",
          message,
          requiresExplicitAcceptance: false,
        },
      ],
      technical: [{ label: "Frontière", value: "HTTP → route serveur V3" }],
    },
    metadata: {
      engine: "cp-sat",
      respectedLocks: !unmetPreservations.includes("locks"),
      respectedManualEdits: !unmetPreservations.includes("manual-edits"),
      minimizedOtherChanges: false,
      unmetPreservations,
      optimality: "none",
      candidateSpace: "incomplete",
      stopCause: "backend-error",
    },
  }
}
