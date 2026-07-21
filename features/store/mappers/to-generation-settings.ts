import type { DateRange, IsoDateTime, PlanningId } from "@/features/core/models"
import type { GenerationSettings } from "@/features/core/planning-generator"

import type { StoreConfiguration } from "@/features/store/models"
import { toScoringPolicy } from "@/features/store/mappers/to-scoring-policy"
import { toFairnessPolicy } from "@/features/store/mappers/to-fairness-policy"

/**
 * The run-specific scope a store configuration cannot supply: which planning,
 * over what horizon, evaluated at what clock. Provided by the caller per run.
 */
export interface GenerationScope {
  readonly planningId: PlanningId
  readonly period: DateRange
  readonly now: IsoDateTime
}

/**
 * Map a `StoreConfiguration` + run scope to the planning generator's
 * `GenerationSettings`. The planning mode and both engine policies come from the
 * configuration; only the run scope is per-invocation.
 */
export function toGenerationSettings(
  config: StoreConfiguration,
  scope: GenerationScope
): GenerationSettings {
  return {
    planningId: scope.planningId,
    period: scope.period,
    now: scope.now,
    mode: config.planning.mode,
    scoringPolicy: toScoringPolicy(config),
    fairnessPolicy: toFairnessPolicy(config),
    minimumRestMinutes: config.shift.minRestBetweenShifts,
    timeIncrementMinutes: 15,
    maximumDailyMinutes: config.shift.maxDailyDuration,
  }
}
