import type {
  DateRange,
  IsoDateTime,
  PlanningId,
  PlanningMode,
} from "@/features/core/models"

import type { ScoringPolicy } from "@/features/core/scoring-engine"
import type { FairnessPolicy } from "@/features/core/fairness-engine"

/**
 * GenerationSettings — the "Planning Settings" input: HOW to build the planning
 * and how to evaluate it. Carries no domain data, only identity, horizon and
 * optional policy pass-throughs for the downstream engines.
 *
 * `now` and the ids make generation fully deterministic (no wall-clock, no
 * random) — the same input always yields byte-identical output.
 */
export interface GenerationSettings {
  /** Id assigned to the generated planning. */
  readonly planningId: PlanningId
  /** The horizon the planning covers; drives the evaluation calculators. */
  readonly period: DateRange
  /** Evaluation clock stamped on every created entity and passed to constraints. */
  readonly now: IsoDateTime
  /** Which planning mode produced the schedule (recorded on the Planning). */
  readonly mode: PlanningMode

  /** Optional scoring policy; defaults to the scoring engine's default. */
  readonly scoringPolicy?: ScoringPolicy
  /** Optional fairness policy; defaults to the fairness engine's default. */
  readonly fairnessPolicy?: FairnessPolicy
  readonly minimumRestMinutes?: number
  readonly timeIncrementMinutes?: number
  readonly maximumDailyMinutes?: number
}
