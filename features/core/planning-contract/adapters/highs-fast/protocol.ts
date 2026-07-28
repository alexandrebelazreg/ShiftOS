import type { PlanningAssignmentV3 } from "@/features/core/planning-v3/types/solution"

/**
 * The wire format between Node and `highs_service.py`.
 *
 * A separate protocol from CP-SAT's rather than a shared one. The two engines
 * answer different questions — one proves an optimum across lexicographic
 * passes, the other decomposes and never claims a proof — so their envelopes
 * carry different evidence. Forcing one shape onto both would mean either
 * fields CP-SAT fills and HiGHS leaves null, or the reverse, and a reader
 * would have to know which engine produced a row to know which nulls mean
 * "absent" rather than "zero".
 *
 * The version string is checked on arrival. A mismatch is a transport failure,
 * never a verdict: a process answering in a protocol we did not ask for has
 * told us nothing about the week.
 */
export const HIGHS_FAST_PROTOCOL_VERSION = "planning-v3-highs/1"

export interface HighsFastOptions {
  /** Budget handed to the engine. Clamped on both sides of the pipe. */
  readonly timeoutSeconds: number
}

export interface HighsFastRequestEnvelope {
  readonly protocolVersion: typeof HIGHS_FAST_PROTOCOL_VERSION
  readonly requestId: string
  readonly problem: unknown
  readonly options: HighsFastOptions
}

/**
 * What the engine may say about a week.
 *
 * `solved` covers both a schedule with nothing missing and one with a measured
 * shortfall: a week the team cannot fully cover is still a week they will work,
 * and the size of the gap belongs in the report rather than in the status.
 *
 * `no-solution` is the one that matters most. The engine exhausted a HEURISTIC
 * neighbourhood and found nothing — which proves nothing about the week. Only
 * `infeasible` claims impossibility, and only when the demand model or the
 * allocation MILP actually proved it.
 */
export type HighsFastStatus =
  | "solved"
  | "infeasible"
  | "invalid-problem"
  | "no-solution"
  | "error"

export interface HighsFastResponseEnvelope {
  readonly protocolVersion: string
  readonly requestId: string
  readonly status: HighsFastStatus
  readonly assignments: readonly PlanningAssignmentV3[]
  readonly diagnostics: Record<string, unknown>
  readonly environment: Record<string, unknown>
  readonly error: { readonly code: string; readonly message: string } | null
  readonly problemFingerprint?: string | null
  readonly solutionFingerprint?: string | null
}

export type HighsFastParse =
  | { readonly ok: true; readonly envelope: HighsFastResponseEnvelope }
  | { readonly ok: false; readonly code: string; readonly message: string }

const STATUSES: readonly string[] = [
  "solved",
  "infeasible",
  "invalid-problem",
  "no-solution",
  "error",
]

/**
 * Read what the process wrote, trusting none of it.
 *
 * A subprocess can print a warning before its JSON, die halfway through a
 * write, or be an entirely different program than the one intended. Each of
 * those produces text that is not a valid envelope, and every one of them must
 * end as a transport failure — never as a schedule, and never as an
 * infeasibility. So the shape is checked field by field here rather than cast.
 */
export function parseHighsFastResponse(stdout: string): HighsFastParse {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    return { ok: false, code: "empty-output", message: "Le processus n'a rien écrit." }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return {
      ok: false,
      code: "output-not-json",
      message: `Sortie illisible : ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: "output-not-an-object", message: "La sortie n'est pas un objet." }
  }

  const candidate = parsed as Record<string, unknown>
  if (candidate.protocolVersion !== HIGHS_FAST_PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "protocol-version-mismatch",
      message: `Protocole attendu ${HIGHS_FAST_PROTOCOL_VERSION}, reçu ${JSON.stringify(candidate.protocolVersion)}.`,
    }
  }
  if (typeof candidate.status !== "string" || !STATUSES.includes(candidate.status)) {
    return {
      ok: false,
      code: "unknown-status",
      message: `Statut ${JSON.stringify(candidate.status)} hors protocole.`,
    }
  }
  if (!Array.isArray(candidate.assignments)) {
    return {
      ok: false,
      code: "malformed-assignments",
      message: "`assignments` n'est pas un tableau.",
    }
  }
  // A schedule-bearing status with no schedule is a contradiction, and letting
  // it through would surface an empty week as a successful generation.
  if (candidate.status === "solved" && candidate.assignments.length === 0) {
    return {
      ok: false,
      code: "solved-without-assignments",
      message: "Statut `solved` sans aucune affectation.",
    }
  }

  return { ok: true, envelope: candidate as unknown as HighsFastResponseEnvelope }
}
