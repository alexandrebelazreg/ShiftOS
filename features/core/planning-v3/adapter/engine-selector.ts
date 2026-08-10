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
 *
 * There is one engine today, so the selector always resolves to it. It is kept
 * rather than deleted because it is the seam the injection rule is written on:
 * remove it and the first module that needs to know its engine will reach for a
 * global instead.
 */
export interface PlanningEngineSelector {
  readonly version: PlanningEngineVersion
  /** True when the V3 problem/solve/validate pipeline is what the manager sees. */
  readonly usesV3: boolean
}

export function createPlanningEngineSelector(
  version: PlanningEngineVersion = CURRENT_PLANNING_ENGINE_VERSION
): PlanningEngineSelector {
  return { version, usesV3: true }
}

/** The selector in force when nobody has chosen. */
export const defaultPlanningEngineSelector: PlanningEngineSelector =
  createPlanningEngineSelector()
