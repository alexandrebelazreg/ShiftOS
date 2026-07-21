import {
  CURRENT_PLANNING_ENGINE_VERSION,
  type PlanningEngineVersion,
} from "@/features/core/planning-v3/types/engine-version"

/**
 * The engine selector, as an injected dependency.
 *
 * The application decides which engine version is in force and passes it down.
 * No Core module reads that decision from `localStorage`, an environment
 * variable or a React context — a Core that discovers its own configuration is
 * a Core that can silently change behaviour, which is exactly the failure mode
 * Planning V3 exists to remove.
 */
export interface PlanningEngineSelector {
  readonly version: PlanningEngineVersion
  /** True when V3 must run at all, in shadow or in production. */
  readonly runsV3: boolean
  /** True when V3 output is what the user actually sees. */
  readonly publishesV3: boolean
}

export function createPlanningEngineSelector(
  version: PlanningEngineVersion = CURRENT_PLANNING_ENGINE_VERSION
): PlanningEngineSelector {
  return {
    version,
    runsV3: version !== "v2",
    publishesV3: version === "v3",
  }
}

/**
 * The selector in force for Sprint V3A.
 *
 * It resolves to `v2`, so the planning the application publishes is still the
 * one Sprint 3D.1 produces. `v3-shadow` and `v3` are declared but deliberately
 * not wired to anything yet, and there is NO automatic fallback between
 * versions: switching engines will be an explicit decision, never a silent
 * recovery from a V3 failure.
 */
export const planningEngineSelectorV3A: PlanningEngineSelector = createPlanningEngineSelector("v2")
