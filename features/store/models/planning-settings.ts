import type { Minutes, PlanningMode, TimeGranularity } from "@/features/core/models"

/**
 * PlanningSettings — HOW plannings are generated. Reuses the core `PlanningMode`
 * (`shift_library` | `dynamic`) and `TimeGranularity` (15 | 30 | 60). The shift
 * duration bounds drive dynamic generation.
 */
export interface PlanningSettings {
  readonly mode: PlanningMode
  readonly granularity: TimeGranularity
  readonly minShiftDuration: Minutes
  readonly maxShiftDuration: Minutes
}
