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
  /**
   * Which sectors this planning covered.
   *
   * Optional because records saved before closing fairness existed carry none,
   * and there is no way to recover it: no shift, assignment or planning names a
   * sector. Such a record is deliberately EXCLUDED from every sector's history
   * rather than guessed at — attributing one sector's closings to another would
   * corrupt the very fairness this field exists to compute.
   */
  readonly sectorIds?: readonly string[]
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
  /**
   * Les rayons couverts par ce planning.
   *
   * Un planning ne couvre PAS forcément tout le magasin : une semaine se
   * génère rayon par rayon. Sans cette liste, le tableau de bord ne pouvait
   * annoncer qu'une semaine « publiée » dès le premier rayon publié, alors
   * qu'il en restait cinq à faire.
   */
  readonly sectorIds?: readonly string[]
}

export function toSummary(record: PlanningRecord): PlanningSummary {
  return {
    id: record.id,
    status: record.status,
    label: record.label,
    periodStart: record.periodStart,
    periodEnd: record.periodEnd,
    updatedAt: record.updatedAt,
    ...(record.sectorIds === undefined ? {} : { sectorIds: record.sectorIds }),
  }
}

/** Human label derived from the state (store name + period). */
export function buildPlanningLabel(state: EditorState): string {
  const name = state.configuration.general.name.trim() || "Planning"
  return `${name} · ${state.planning.periodStart} → ${state.planning.periodEnd}`
}
