/**
 * Which planning engine produces the schedule the application shows.
 *
 * - `v2` — the frozen Sprint 3D.1 business pipeline. The default, and what a
 *          manager gets unless they deliberately ask for something else.
 * - `v3` — the CP-SAT engine behind the unified solve contract. EXPERIMENTAL,
 *          opt-in per session, and reversible in one click.
 *
 * There is no shadow mode. Running V3 silently alongside V2 would produce a
 * second schedule nobody looks at, on every generation, for a comparison no one
 * asked for — and the moment its output diverged there would be no way to tell
 * whether V2 or V3 was wrong from a screen showing only one of them. A single
 * user who wants to try V3 is better served by actually seeing V3, with V2 one
 * click away.
 *
 * The selector is INJECTED into the Core, never read from it: no Core module
 * may reach for `localStorage`, an environment variable or a React context to
 * discover which engine it is part of.
 */
export const PLANNING_ENGINE_VERSIONS = ["v2", "v3"] as const
export type PlanningEngineVersion = (typeof PLANNING_ENGINE_VERSIONS)[number]

/**
 * The value in force when nobody has chosen.
 *
 * V2. It stays V2 for as long as V3 is experimental: a default is what runs for
 * someone who never opened the control, and that person must get the engine
 * whose behaviour the product actually promises.
 */
export const CURRENT_PLANNING_ENGINE_VERSION: PlanningEngineVersion = "v2"

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
}
