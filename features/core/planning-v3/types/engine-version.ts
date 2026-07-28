/**
 * Which planning engine produces the schedule the application shows.
 *
 * - `v2` — the frozen Sprint 3D.1 business pipeline. The default, and what a
 *          manager gets unless they deliberately ask for something else.
 * - `v3` — the CP-SAT engine behind the unified solve contract. EXPERIMENTAL,
 *          opt-in per session, and reversible in one click.
 * - `v3-decomposed` — the decomposed TypeScript engine: allocate, skeleton,
 *          reduced candidates, exact placement, bounded repair. EXPERIMENTAL
 *          and opt-in, exactly like `v3`, and running ALONGSIDE it rather than
 *          replacing it. It is a separate value rather than a mode of `v3`
 *          because the two are different engines with different failure modes,
 *          and a support log that cannot tell them apart is a support log that
 *          cannot explain a bad week.
 * - `v3-highs-fast` — the decomposed MILP engine, in Python behind the same
 *          subprocess boundary as CP-SAT. Skeletons first, then one small
 *          allocation model per skeleton, then exact placement. EXPERIMENTAL
 *          and opt-in like the other two.
 *
 * Nothing is retired here. `v3` is slow and proves its optimum, which is what
 * makes it the reference that can show a fast engine regressed; delete the
 * oracle and you delete the ability to know. And `v3-decomposed` is the only V3
 * that runs without Python — the only one that survives a deployment where no
 * interpreter exists.
 *
 * WHICH BRINGS A DEBT WORTH WRITING DOWN: `v3` and `v3-highs-fast` are LOCAL
 * ONLY today. Both spawn Python, and the repository carries no deployment
 * configuration at all. The day ShiftOS ships, either the image carries Python
 * with scipy, HiGHS and OR-Tools, or these two must be hidden in that
 * environment — otherwise the failure mode is a `python-not-found` in front of
 * the first manager who clicks, not an error at build time.
 *
 * There is no shadow mode. Running an engine silently alongside another would
 * produce a second schedule nobody looks at, on every generation, for a
 * comparison no one asked for — and the moment its output diverged there would
 * be no way to tell which was wrong from a screen showing only one of them. A
 * user who wants to try an experimental engine is better served by actually
 * seeing it, with V2 one click away.
 *
 * The selector is INJECTED into the Core, never read from it: no Core module
 * may reach for `localStorage`, an environment variable or a React context to
 * discover which engine it is part of.
 */
export const PLANNING_ENGINE_VERSIONS = ["v2", "v3", "v3-decomposed", "v3-highs-fast"] as const
export type PlanningEngineVersion = (typeof PLANNING_ENGINE_VERSIONS)[number]

/**
 * The value in force when nobody has chosen.
 *
 * V2. It stays V2 for as long as any V3 engine is experimental: a default is
 * what runs for someone who never opened the control, and that person must get
 * the engine whose behaviour the product actually promises. Adding
 * `v3-decomposed` does NOT move it.
 */
export const CURRENT_PLANNING_ENGINE_VERSION: PlanningEngineVersion = "v2"

/**
 * True for every engine that goes through the V3 problem/solve/validate
 * pipeline, whichever solver sits at the end of it.
 *
 * Written once and exported because the alternative is a literal `=== "v3"`
 * repeated across the view layer — which is exactly how adding a second V3
 * engine silently turns a V3 screen back into a V2 one in the six places
 * somebody forgot to update. Callers asking "which V3 pipeline is this" ask
 * this; callers needing the specific solver read the version itself, and only
 * the composition layer is allowed to.
 */
export function usesV3Pipeline(version: PlanningEngineVersion): boolean {
  return version !== "v2"
}

/**
 * Which engine the solve endpoint is asked for, per selected version.
 *
 * A table rather than a ternary at the call site. With two engines a ternary
 * was readable; with three it silently routes the newest one to whichever
 * branch happens to be the `else`, and the symptom is a manager selecting one
 * engine and being served another — with nothing in the response saying so.
 */
const ENDPOINT_ENGINE: Readonly<Record<PlanningEngineVersion, "cp-sat" | "decomposed" | "highs-fast">> =
  {
    // V2 never reaches this endpoint; mapped only so the record stays total and
    // a new version cannot be added without deciding where it routes.
    v2: "cp-sat",
    v3: "cp-sat",
    "v3-decomposed": "decomposed",
    "v3-highs-fast": "highs-fast",
  }

export function endpointEngineFor(
  version: PlanningEngineVersion
): "cp-sat" | "decomposed" | "highs-fast" {
  return ENDPOINT_ENGINE[version]
}

export function isPlanningEngineVersion(value: unknown): value is PlanningEngineVersion {
  return (
    typeof value === "string" &&
    (PLANNING_ENGINE_VERSIONS as readonly string[]).includes(value)
  )
}

/** The label a manager reads. Worded once so no screen invents its own. */
export const PLANNING_ENGINE_LABELS: Readonly<Record<PlanningEngineVersion, string>> = {
  v2: "V2 stable",
  v3: "V3 expérimental",
  "v3-decomposed": "V3 décomposé",
  "v3-highs-fast": "V3 rapide (HiGHS)",
}
