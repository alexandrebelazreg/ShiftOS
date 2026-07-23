import type { PlanningAssignmentV3 } from "@/features/core/planning-v3/types/solution"

/**
 * The JSON envelope spoken across the CP-SAT process boundary.
 *
 * A process boundary is a version boundary whether or not anyone declares one,
 * so this file declares one. `CP_SAT_PROTOCOL_VERSION` is checked on BOTH
 * sides and a mismatch is refused rather than tolerated: envelopes from two
 * versions differ most dangerously in a field whose absence reads as a legal
 * default — an older Python that ignores `preservation` would happily return a
 * schedule that silently discards every lock, and it would look like a success.
 *
 * Everything here is plain data. No solver, no Node API: the envelope can be
 * built, inspected and asserted in a unit test with nothing installed.
 */
export const CP_SAT_PROTOCOL_VERSION = "planning-v3-cpsat/1"

/** One assignment pinned as a hard constraint, already resolved to minutes. */
export interface CpSatPinnedAssignment {
  readonly shiftId: string
  readonly employeeId: string
  readonly date: string
  readonly startMinutes: number
  readonly endMinutes: number
}

/**
 * What the manager asked to protect, resolved.
 *
 * Resolution happens on THIS side, where it is pure and unit tested. Python
 * receives employees, dates and minutes — never a `shiftId` it would have to
 * interpret, and never a baseline it would have to search.
 */
export interface CpSatPreservationPayload {
  readonly lockedAssignments: readonly CpSatPinnedAssignment[]
  readonly editedAssignments: readonly CpSatPinnedAssignment[]
  /** The reference schedule pass 4 measures drift from. Empty disables it. */
  readonly baselineAssignments: readonly CpSatPinnedAssignment[]
  readonly minimizeOtherChanges: boolean
}

/**
 * The two profiles the application may ask for.
 *
 * A profile is a BUDGET and a set of search options — never a change of
 * objective, rule or candidate space. The same week solved under either one is
 * legal under the other; only how far the lexicographic proofs got may differ.
 */
export type CpSatProfile = "fast" | "thorough"

export interface CpSatSolverOptions {
  readonly profile: CpSatProfile
  readonly timeoutSeconds: number
  readonly seed: number
  /** One worker keeps the run reproducible; the portfolio is not. */
  readonly workers: number
  /**
   * Carry each pass's solution into the next as a CP-SAT hint.
   *
   * A hint is a suggestion, never a constraint: it changes how fast a pass
   * converges, never which optimum is admissible. Hints come only from earlier
   * V3 passes — no V2 schedule seeds them — and a lock or a manual edit is
   * never demoted from hard constraint to hint.
   */
  readonly useHints: boolean
}

export interface CpSatRequestEnvelope {
  readonly protocolVersion: typeof CP_SAT_PROTOCOL_VERSION
  readonly requestId: string
  readonly problem: unknown
  readonly preservation: CpSatPreservationPayload
  readonly options: CpSatSolverOptions
}

/** What one lexicographic pass achieved, and whether it was proven. */
export interface CpSatPass {
  readonly pass: string
  readonly status: string
  readonly objective: number | null
  readonly bestBound: number | null
  readonly proven: boolean
  readonly seconds: number
}

/** An assignment the model could not express. Reported, never approximated. */
export interface CpSatUnmatchedPreservation {
  readonly kind: "lockedAssignments" | "editedAssignments"
  readonly shiftId: string | null
  readonly reason: string
}

export interface CpSatStability {
  readonly driftMinutes: number
  readonly removedShifts: number
  readonly addedShifts: number
  readonly startShiftMinutes: number
  readonly endShiftMinutes: number
}

/**
 * The four statuses Python may report, and what each one claims.
 *
 * `infeasible` is a PROOF; `no-solution` is a statement about the clock. They
 * are separate values because collapsing them would let a slow machine declare
 * a week impossible.
 */
export type CpSatStatus = "solved" | "infeasible" | "invalid-problem" | "no-solution" | "error"

export interface CpSatResponseEnvelope {
  readonly protocolVersion: string
  readonly requestId: string
  readonly status: CpSatStatus
  readonly assignments: readonly PlanningAssignmentV3[]
  readonly passes: readonly CpSatPass[]
  readonly candidateSpace: "complete" | "incomplete"
  readonly stopCause: "exhausted" | "timeout" | "not-started"
  /**
   * What ended the ladder, in words, when it did not run to completion.
   *
   * `stopCause` answers "was the run complete"; this answers "what stopped it"
   * — an unproven pass the next level was forbidden to freeze, or a budget too
   * small to start another pass. Surfaced as a technical fact so the reason is
   * visible rather than inferred from timings.
   */
  readonly stopDetail?: string | null
  readonly unmatchedPreservations: readonly CpSatUnmatchedPreservation[]
  readonly stability: CpSatStability | null
  readonly environment: Record<string, unknown>
  readonly error: { readonly code: string; readonly message: string } | null
  readonly problemFingerprint?: string
  readonly solutionFingerprint?: string
  readonly model?: Record<string, number>
}

export type CpSatParse =
  | { readonly ok: true; readonly envelope: CpSatResponseEnvelope }
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
 * end as `backend-error` — never as a schedule, and never as an infeasibility.
 * So the shape is checked field by field here rather than cast.
 */
export function parseCpSatResponse(stdout: string): CpSatParse {
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
  if (candidate.protocolVersion !== CP_SAT_PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "protocol-version-mismatch",
      message: `Protocole attendu ${CP_SAT_PROTOCOL_VERSION}, reçu ${JSON.stringify(candidate.protocolVersion)}.`,
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
    return { ok: false, code: "malformed-assignments", message: "`assignments` n'est pas un tableau." }
  }
  if (candidate.status === "solved" && candidate.stopCause !== "exhausted" && candidate.stopCause !== "timeout") {
    return {
      ok: false,
      code: "malformed-stop-cause",
      message: `Une résolution aboutie ne peut pas s'arrêter sur ${JSON.stringify(candidate.stopCause)}.`,
    }
  }

  return { ok: true, envelope: candidate as unknown as CpSatResponseEnvelope }
}
