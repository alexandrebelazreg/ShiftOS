import type { EditorState } from "@/features/planning/editor"

import type { PlanningRecord, PlanningStatus } from "@/features/planning/persistence/planning-record"
import { buildPlanningLabel } from "@/features/planning/persistence/planning-record"

/**
 * Pure lifecycle rules for a planning record. No storage, no React — just the
 * business logic of the Draft → Published → Archived lifecycle.
 */

/** Legal transitions. Absence of a target means the transition is forbidden. */
const ALLOWED_TRANSITIONS: Record<PlanningStatus, readonly PlanningStatus[]> = {
  draft: ["published"],
  published: ["archived"],
  archived: [],
}

export function canTransition(from: PlanningStatus, to: PlanningStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** Only a draft is editable; published and archived plannings are read-only. */
export function canEdit(record: PlanningRecord): boolean {
  return record.status === "draft"
}

export function isReadOnly(record: PlanningRecord): boolean {
  return !canEdit(record)
}

/** Create a fresh draft record wrapping the given editor state. */
export function createDraft(state: EditorState, now: string, id: string): PlanningRecord {
  return {
    id,
    status: "draft",
    label: buildPlanningLabel(state),
    periodStart: state.planning.periodStart,
    periodEnd: state.planning.periodEnd,
    state,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
  }
}

/** Persist a new editor state into a DRAFT record (saving). Rejects read-only. */
export function withSavedState(
  record: PlanningRecord,
  state: EditorState,
  now: string
): PlanningRecord {
  if (!canEdit(record)) {
    throw new Error(`Cannot save a ${record.status} planning; it is read-only.`)
  }
  return { ...record, state, label: buildPlanningLabel(state), updatedAt: now, savedAt: now }
}

/** Publish a draft. Published planning becomes read-only; never modified after. */
export function publish(record: PlanningRecord, now: string): PlanningRecord {
  if (!canTransition(record.status, "published")) {
    throw new Error(`Cannot publish a ${record.status} planning.`)
  }
  return { ...record, status: "published", updatedAt: now }
}

/** Archive a published planning. Archived stays readable, not editable. */
export function archive(record: PlanningRecord, now: string): PlanningRecord {
  if (!canTransition(record.status, "archived")) {
    throw new Error(`Cannot archive a ${record.status} planning.`)
  }
  return { ...record, status: "archived", updatedAt: now }
}

/**
 * Editing a published planning creates a NEW draft cloned from its state. The
 * published record is never modified — this returns a brand-new draft.
 */
export function draftFromPublished(
  record: PlanningRecord,
  now: string,
  id: string
): PlanningRecord {
  if (record.status !== "published") {
    throw new Error(`Only a published planning can be edited into a new draft.`)
  }
  return { ...createDraft(record.state, now, id), label: `${record.label} (edited)` }
}
