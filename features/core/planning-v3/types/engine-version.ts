/**
 * Which planning engine produces the schedule the application shows.
 *
 * - `v3-highs-fast` — the decomposed MILP engine, in Python behind a subprocess
 *          boundary. Skeletons first, then one small allocation model per
 *          skeleton, then exact placement.
 *
 * ONE engine. The registry is kept as a type rather than collapsed into a bare
 * string because every screen, log line and stored result names its engine, and
 * a named constant is what makes "which engine produced this week?" answerable
 * from a support log. It is also what makes adding a second engine a deliberate
 * edit here rather than a literal sprinkled across the view layer.
 *
 * ── What was removed, and what went with it ─────────────────────────────────
 *
 * `v2` (the Sprint 3D.1 business pipeline), `v3` (the CP-SAT oracle) and
 * `v3-decomposed` (the TypeScript decomposed engine) were deleted on request.
 * Two consequences were accepted explicitly and are written down here because
 * neither is visible from any screen:
 *
 * 1. NO PYTHON, NO PLANNING. `v3-decomposed` was the only engine that ran
 *    without an interpreter. The repository still carries no deployment
 *    configuration, so the day Planiteo ships, the image must provide Python
 *    with scipy and HiGHS — otherwise the failure mode is `python-not-found` in
 *    front of the first manager who clicks Generate, not an error at build time.
 * 2. NO ORACLE. `v3` proved its optimum, which is what made it able to show
 *    that a fast engine had regressed. Nothing proves an optimum now, so a
 *    regression in schedule QUALITY — as opposed to legality, which the
 *    validator still catches — can only be noticed against the committed
 *    reference schedules.
 */
export const PLANNING_ENGINE_VERSIONS = ["v3-highs-fast"] as const
export type PlanningEngineVersion = (typeof PLANNING_ENGINE_VERSIONS)[number]

/** The value in force when nobody has chosen. There is only one. */
export const CURRENT_PLANNING_ENGINE_VERSION: PlanningEngineVersion = "v3-highs-fast"

/**
 * True for every engine that goes through the V3 problem/solve/validate
 * pipeline.
 *
 * Now always true, and kept for exactly that reason: the call sites asking it
 * mean "is this the V3 pipeline?", and answering with a literal `true` spread
 * across the view layer is how a second engine, one day, silently gets treated
 * as V3 when it is not.
 */
export function usesV3Pipeline(): boolean {
  return true
}

/** Which engine the solve endpoint is asked for. */
export function endpointEngineFor(): "highs-fast" {
  return "highs-fast"
}

export function isPlanningEngineVersion(value: unknown): value is PlanningEngineVersion {
  return (
    typeof value === "string" &&
    (PLANNING_ENGINE_VERSIONS as readonly string[]).includes(value)
  )
}

/** The label a manager reads. Worded once so no screen invents its own. */
export const PLANNING_ENGINE_LABELS: Readonly<Record<PlanningEngineVersion, string>> = {
  "v3-highs-fast": "V3 rapide",
}
