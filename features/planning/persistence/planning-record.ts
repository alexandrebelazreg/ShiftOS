import type { EditorState } from "@/features/planning/editor"

/**
 * Lifecycle states of a persisted planning. Exactly one at a time:
 *   draft → published → archived
 * This is the PERSISTENCE status of the saved record — distinct from the core
 * `Planning.status`, which the frozen engines own and this sprint never touches.
 */
export const PLANNING_STATUSES = ["draft", "published", "archived"] as const
export type PlanningStatus = (typeof PLANNING_STATUSES)[number]

/**
 * PlanningRecord — a planning as a persisted business entity. It wraps the
 * COMPLETE `EditorState` (the single source of truth) plus lifecycle metadata,
 * so reopening a record restores the editor exactly as it was left.
 */
export interface PlanningRecord {
  readonly id: string
  readonly status: PlanningStatus
  readonly label: string
  readonly periodStart: string
  readonly periodEnd: string
  /** The full editor state — everything needed to restore the editor. */
  readonly state: EditorState
  readonly createdAt: string
  readonly updatedAt: string
  /** When the state was last persisted (for the "saved / unsaved" indicator). */
  readonly savedAt: string
}

/** A lightweight projection for listing saved plannings. */
export interface PlanningSummary {
  readonly id: string
  readonly status: PlanningStatus
  readonly label: string
  readonly periodStart: string
  readonly periodEnd: string
  readonly updatedAt: string
}

export function toSummary(record: PlanningRecord): PlanningSummary {
  return {
    id: record.id,
    status: record.status,
    label: record.label,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    updatedAt: record.updatedAt,
  }
}

/** Human label derived from the state (store name + period). */
export function buildPlanningLabel(state: EditorState): string {
  const name = state.configuration.general.name.trim() || "Planning"
  return `${name} · ${state.planning.periodStart} → ${state.planning.periodEnd}`
}
