import type {
  IsoDate,
  PlanningId,
  PlanningMode,
  StoreId,
  Timestamps,
} from "@/features/core/models/common"

/**
 * Lifecycle status of a planning.
 * TODO: confirm the full lifecycle with the product domain.
 */
export const PLANNING_STATUSES = ["draft", "published"] as const
export type PlanningStatus = (typeof PLANNING_STATUSES)[number]

/**
 * Planning — a schedule for a store over a date range, made of Assignments.
 *
 * Relationships:
 * - belongs to one Store (`storeId`, many-to-one).
 * - has many Assignments (see `Assignment.planningId`).
 */
export interface Planning extends Timestamps {
  id: PlanningId
  storeId: StoreId

  status: PlanningStatus
  periodStart: IsoDate
  periodEnd: IsoDate
  /** Which planning mode produced this schedule. */
  generatedWith: PlanningMode

  // TODO: publishedAt / generatedAt metadata once the workflow is defined.
}
