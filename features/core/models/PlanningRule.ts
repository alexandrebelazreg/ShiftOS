import type {
  PlanningRuleId,
  StoreId,
} from "@/features/core/models/common"

/**
 * Known store-wide planning rules (the general working-time baselines set
 * during onboarding). Open set so new rule types can be added as data.
 */
export const PLANNING_RULE_TYPES = [
  "MIN_DAILY_HOURS",
  "MAX_DAILY_HOURS",
  "MIN_REST_BETWEEN_SHIFTS",
  "MAX_WEEKLY_HOURS",
] as const
export type KnownPlanningRuleType = (typeof PLANNING_RULE_TYPES)[number]
export type PlanningRuleType = KnownPlanningRuleType | (string & {})

/** Unit a rule value is expressed in. */
export const PLANNING_RULE_UNITS = ["hours", "minutes"] as const
export type PlanningRuleUnit = (typeof PLANNING_RULE_UNITS)[number]

/**
 * PlanningRule — a store-wide constraint applied when generating plannings.
 *
 * This is distinct from `PlanningSettings` (which describes HOW shifts are
 * generated). A rule expresses a baseline limit (e.g. maximum daily hours).
 * Modelled as a flexible list so rules can be added/removed without changing
 * the Store model.
 *
 * Relationships:
 * - belongs to one Store (`storeId`, many-to-one).
 */
export interface PlanningRule {
  id: PlanningRuleId
  storeId: StoreId
  type: PlanningRuleType
  value: number
  unit: PlanningRuleUnit
  /** Escape hatch for richer future rule types. */
  params?: Record<string, unknown>
}
