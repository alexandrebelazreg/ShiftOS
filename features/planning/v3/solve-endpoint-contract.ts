import { PLANNING_PROBLEM_V3_VERSION } from "@/features/core/planning-v3/types/problem"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"
import type { PlanningRegenerationRequest } from "@/features/core/planning-contract/types/regeneration"

/**
 * The wire contract between the browser and the CP-SAT route handler.
 *
 * Separate from the CP-SAT process protocol on purpose: this one crosses the
 * network, the other crosses a pipe, and they version independently. It is also
 * PURE — no Next.js, no `node:` anything — so the route handler is a thin shell
 * over functions a unit test can call directly, and so the client can import
 * the request type without importing a solver.
 *
 * Everything arriving here is untrusted. The browser is the only caller today,
 * but a route handler is a public HTTP surface the moment it exists, and the
 * thing on the other end of it runs a native solver in a subprocess.
 */
export const PLANNING_V3_ENDPOINT_VERSION = "planning-v3-solve/1"
export const PLANNING_V3_ENDPOINT_PATH = "/api/planning/v3/solve"

/**
 * Largest payload accepted, in bytes.
 *
 * The Drive week serialises to roughly 100 kB; a month of a large store would
 * stay well under a megabyte. Two is generous enough that no legitimate request
 * is refused and small enough that a malformed or hostile body is rejected
 * before it is parsed, rather than after it has been turned into objects.
 */
export const PLANNING_V3_MAX_PAYLOAD_BYTES = 2 * 1024 * 1024

/**
 * Bounds on the solver budget a caller may ask for, in seconds.
 *
 * The ceiling is the deep profile's budget. Above it a request stops being an
 * optimisation and becomes a held screen, so it is refused at the boundary
 * rather than honoured by a process nobody is still waiting for.
 */
export const PLANNING_V3_MIN_TIMEOUT_SECONDS = 1
export const PLANNING_V3_MAX_TIMEOUT_SECONDS = 300
/**
 * The everyday budget: the `fast` profile's.
 *
 * Measured, not chosen. It is the smallest budget at which the first TWO
 * objectives are proven reproducibly on the Drive week. Shorter budgets were
 * tried: 60 s never proved the first one and returned a schedule whose quality
 * changed from click to click; 90 s proved the first but abandoned the second
 * with 180 minutes of deficit unoptimised.
 */
export const PLANNING_V3_DEFAULT_TIMEOUT_SECONDS = 120

/**
 * The two profiles a caller may ask for.
 *
 * `fast` is the default and what a manager clicking "Générer" gets. `thorough`
 * is a deliberate act: the same problem, the same rules and the same candidate
 * space, given room to finish proving the lower objectives. Neither changes
 * what is being optimised.
 */
export const PLANNING_V3_PROFILES = ["fast", "thorough"] as const
export type PlanningV3Profile = (typeof PLANNING_V3_PROFILES)[number]
export const PLANNING_V3_DEFAULT_PROFILE: PlanningV3Profile = "fast"

/**
 * Which engine the caller is asking for.
 *
 * A REQUEST field rather than a server setting, because the choice belongs to
 * the person clicking: the engine selector on the planning screen is a per-run
 * decision, and a server that decided for them would make "which engine made
 * this schedule" unanswerable from the client that asked for it.
 *
 * Deliberately narrower than `PlanningEngineVersion`: `v2` never crosses this
 * endpoint — it runs client-side and has done since long before V3 existed —
 * so accepting the value here would advertise a route that cannot serve it.
 */
export const PLANNING_V3_ENGINES = ["cp-sat", "decomposed", "highs-fast"] as const
export type PlanningV3Engine = (typeof PLANNING_V3_ENGINES)[number]

/**
 * The engine a request without an explicit choice gets.
 *
 * CP-SAT, which is what this endpoint has always run. Adding the decomposed
 * engine must not change the answer any existing caller receives, and an
 * omitted field is exactly such a caller.
 */
export const PLANNING_V3_DEFAULT_ENGINE: PlanningV3Engine = "cp-sat"

export interface PlanningV3SolveRequestBody {
  readonly endpointVersion: typeof PLANNING_V3_ENDPOINT_VERSION
  readonly problem: PlanningProblemV3
  readonly regeneration?: PlanningRegenerationRequest
  readonly baseline?: PlanningBaselineV3
  readonly profile?: PlanningV3Profile
  readonly timeoutSeconds?: number
  readonly engine?: PlanningV3Engine
}

/** Why a request was refused, before any solving was attempted. */
export const PLANNING_V3_REQUEST_ERRORS = [
  "payload-too-large",
  "body-not-json",
  "body-not-an-object",
  "endpoint-version-mismatch",
  "problem-missing",
  "problem-version-mismatch",
  "problem-malformed",
  "regeneration-malformed",
  "baseline-malformed",
  "timeout-out-of-range",
  "unknown-profile",
  "unknown-engine",
] as const
export type PlanningV3RequestErrorCode = (typeof PLANNING_V3_REQUEST_ERRORS)[number]

export type PlanningV3RequestParse =
  | { readonly ok: true; readonly body: PlanningV3SolveRequestBody }
  | {
      readonly ok: false
      readonly code: PlanningV3RequestErrorCode
      readonly message: string
    }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Validate a request body without trusting one field of it.
 *
 * Deliberately structural rather than exhaustive: it checks the shape the route
 * depends on to decide anything — the version, the problem's identity, the
 * collections it will iterate — and leaves the deep semantics to the engine,
 * which validates the problem again and answers `invalid-problem` when it is
 * wrong. Re-implementing the whole V3 schema here would be a second definition
 * of the model, free to drift from the first.
 *
 * None of these refusals is an `infeasible`. A malformed request says nothing
 * whatsoever about whether the week can be staffed.
 */
export function parsePlanningV3Request(raw: string): PlanningV3RequestParse {
  // Measured in bytes, not characters: a body of astral-plane text is twice the
  // length of its string, and the limit protects memory, not readability.
  const bytes = Buffer.byteLength(raw, "utf8")
  if (bytes > PLANNING_V3_MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      code: "payload-too-large",
      message: `Charge de ${bytes} octets, maximum ${PLANNING_V3_MAX_PAYLOAD_BYTES}.`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      ok: false,
      code: "body-not-json",
      message: error instanceof Error ? error.message : "Corps illisible.",
    }
  }

  if (!isObject(parsed)) {
    return { ok: false, code: "body-not-an-object", message: "Le corps doit être un objet JSON." }
  }

  if (parsed.endpointVersion !== PLANNING_V3_ENDPOINT_VERSION) {
    return {
      ok: false,
      code: "endpoint-version-mismatch",
      message: `Version attendue ${PLANNING_V3_ENDPOINT_VERSION}, reçue ${JSON.stringify(parsed.endpointVersion)}.`,
    }
  }

  const problem = parsed.problem
  if (problem === undefined || problem === null) {
    return { ok: false, code: "problem-missing", message: "Aucun problème dans la requête." }
  }
  if (!isObject(problem)) {
    return { ok: false, code: "problem-malformed", message: "Le problème n'est pas un objet." }
  }
  if (problem.version !== PLANNING_PROBLEM_V3_VERSION) {
    return {
      ok: false,
      code: "problem-version-mismatch",
      message: `Version de problème attendue ${PLANNING_PROBLEM_V3_VERSION}, reçue ${JSON.stringify(problem.version)}.`,
    }
  }
  for (const field of ["employees", "days", "employeeDays", "demandSlots", "objectives"]) {
    if (!Array.isArray(problem[field])) {
      return {
        ok: false,
        code: "problem-malformed",
        message: `Le champ « ${field} » du problème doit être un tableau.`,
      }
    }
  }
  if (!isObject(problem.rules) || !isObject(problem.period)) {
    return {
      ok: false,
      code: "problem-malformed",
      message: "Le problème doit porter des règles et une période.",
    }
  }

  const regeneration = parsed.regeneration
  if (regeneration !== undefined && regeneration !== null) {
    if (
      !isObject(regeneration) ||
      !Array.isArray(regeneration.lockedShiftIds) ||
      !Array.isArray(regeneration.editedShifts) ||
      typeof regeneration.preserveLockedShifts !== "boolean" ||
      typeof regeneration.preserveManualEdits !== "boolean" ||
      typeof regeneration.minimizeOtherChanges !== "boolean"
    ) {
      return {
        ok: false,
        code: "regeneration-malformed",
        message: "La régénération doit porter trois drapeaux, des verrous et des retouches.",
      }
    }
  }

  const baseline = parsed.baseline
  if (baseline !== undefined && baseline !== null) {
    if (!isObject(baseline) || !Array.isArray(baseline.shifts)) {
      return {
        ok: false,
        code: "baseline-malformed",
        message: "Le planning de référence doit porter un tableau de shifts.",
      }
    }
  }

  // Refused rather than silently defaulted: a caller asking for a profile this
  // version does not have is asking for a search this version cannot run, and
  // quietly giving them `fast` would answer a different question.
  const profile = parsed.profile
  if (profile !== undefined && !PLANNING_V3_PROFILES.includes(profile as PlanningV3Profile)) {
    return {
      ok: false,
      code: "unknown-profile",
      message: `Profil ${JSON.stringify(profile)} inconnu, attendu ${PLANNING_V3_PROFILES.join(" ou ")}.`,
    }
  }

  // Refused rather than silently defaulted, for the same reason as the profile:
  // a caller naming an engine this version does not have is asking for a search
  // it cannot run, and quietly handing them CP-SAT would answer a different
  // question than the one asked.
  const engine = parsed.engine
  if (engine !== undefined && !PLANNING_V3_ENGINES.includes(engine as PlanningV3Engine)) {
    return {
      ok: false,
      code: "unknown-engine",
      message: `Moteur ${JSON.stringify(engine)} inconnu, attendu ${PLANNING_V3_ENGINES.join(" ou ")}.`,
    }
  }

  const timeoutSeconds = parsed.timeoutSeconds
  if (timeoutSeconds !== undefined) {
    if (
      typeof timeoutSeconds !== "number" ||
      !Number.isFinite(timeoutSeconds) ||
      timeoutSeconds < PLANNING_V3_MIN_TIMEOUT_SECONDS ||
      timeoutSeconds > PLANNING_V3_MAX_TIMEOUT_SECONDS
    ) {
      return {
        ok: false,
        code: "timeout-out-of-range",
        message: `Le délai doit être un nombre entre ${PLANNING_V3_MIN_TIMEOUT_SECONDS} et ${PLANNING_V3_MAX_TIMEOUT_SECONDS} secondes.`,
      }
    }
  }

  return { ok: true, body: parsed as unknown as PlanningV3SolveRequestBody }
}
