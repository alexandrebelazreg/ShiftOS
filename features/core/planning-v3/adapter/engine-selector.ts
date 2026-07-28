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
  /**
   * True when a V3-generation engine is what the manager sees — CP-SAT or the
   * decomposed engine alike.
   *
   * One boolean, not two. While a shadow mode existed, "does V3 run" and "is V3
   * published" were different questions; without it they are the same question
   * and keeping both would only invite a caller to check the wrong one.
   *
   * It answers "does this go through the V3 problem/solve/validate pipeline",
   * NOT "which solver runs". Callers that need the latter read `version`, and
   * only the composition layer is allowed to act on it.
   */
  readonly usesV3: boolean
}

export function createPlanningEngineSelector(
  version: PlanningEngineVersion = CURRENT_PLANNING_ENGINE_VERSION
): PlanningEngineSelector {
  return { version, usesV3: version === "v3" || version === "v3-decomposed" }
}

/**
 * The selector in force when nobody has chosen.
 *
 * It resolves to `v2`, so the planning the application publishes by default is
 * still the one Sprint 3D.1 produces. Choosing `v3` is an explicit, per-session
 * act in the UI, and there is NO automatic movement between versions: a failed
 * V3 run never falls back, it reports and waits for the manager to decide.
 */
export const defaultPlanningEngineSelector: PlanningEngineSelector =
  createPlanningEngineSelector("v2")
