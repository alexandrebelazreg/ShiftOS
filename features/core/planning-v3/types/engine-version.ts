/**
 * Which planning engine produces the schedule the application shows.
 *
 * - `v2`      — the frozen Sprint 3D.1 business pipeline. The only value that
 *               changes anything a user sees today.
 * - `v3-shadow` — V3 runs alongside V2 for comparison; V2 output is published.
 * - `v3`      — V3 output is published.
 *
 * The selector is INJECTED into the Core, never read from it: no Core module
 * may reach for `localStorage`, an environment variable or a React context to
 * discover which engine it is part of.
 */
export const PLANNING_ENGINE_VERSIONS = ["v2", "v3-shadow", "v3"] as const
export type PlanningEngineVersion = (typeof PLANNING_ENGINE_VERSIONS)[number]

/**
 * The value in force for Sprint V3A.
 *
 * V3A ships the V3 problem model, its builder and its independent validator —
 * and nothing that runs them in production. The planning the application
 * displays is still produced by V2 / Sprint 3D.1, byte for byte.
 */
export const CURRENT_PLANNING_ENGINE_VERSION: PlanningEngineVersion = "v2"

export function isPlanningEngineVersion(value: unknown): value is PlanningEngineVersion {
  return (
    typeof value === "string" &&
    (PLANNING_ENGINE_VERSIONS as readonly string[]).includes(value)
  )
}
