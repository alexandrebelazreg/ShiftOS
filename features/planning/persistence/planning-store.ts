import type { EditorState } from "@/features/planning/editor"

import type {
  PlanningRecord,
  PlanningSummary,
} from "@/features/planning/persistence/planning-record"
import { toSummary } from "@/features/planning/persistence/planning-record"
import type { PlanningRepository } from "@/features/planning/persistence/planning-repository"
import { createInMemoryPlanningRepository } from "@/features/planning/persistence/in-memory-planning-repository"
import { createLocalStoragePlanningRepository } from "@/features/planning/persistence/local-storage-planning-repository"
import * as lifecycle from "@/features/planning/persistence/planning-lifecycle"

/**
 * PlanningStore — the application-facing persistence service. It composes the
 * pure lifecycle rules with a repository, exposing the manager actions (create,
 * save, reopen, publish, archive, edit-published, list). All business logic
 * lives in the lifecycle; this only orchestrates and persists. Independent of
 * React.
 */
export interface PlanningStore {
  createDraft(state: EditorState, sectorIds?: readonly string[]): Promise<PlanningRecord>
  save(id: string, state: EditorState, sectorIds?: readonly string[]): Promise<PlanningRecord>
  publish(id: string): Promise<PlanningRecord>
  archive(id: string): Promise<PlanningRecord>
  /** Clone a published planning into a fresh, editable draft (originals stay). */
  editPublished(id: string): Promise<PlanningRecord>
  reopen(id: string): Promise<PlanningRecord | null>
  list(): Promise<PlanningSummary[]>
  remove(id: string): Promise<void>
}

export interface PlanningStoreOptions {
  /** Clock, injectable for deterministic tests. */
  readonly now?: () => string
  /** Id generator, injectable for deterministic tests. */
  readonly generateId?: () => string
}

export function createPlanningStore(
  repository: PlanningRepository,
  options: PlanningStoreOptions = {}
): PlanningStore {
  const now = options.now ?? (() => new Date().toISOString())
  const generateId =
    options.generateId ??
    (() => `planning_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`)

  async function require(id: string): Promise<PlanningRecord> {
    const record = await repository.get(id)
    if (!record) throw new Error(`Planning "${id}" not found.`)
    return record
  }

  return {
    async createDraft(state, sectorIds) {
      const record = lifecycle.createDraft(state, now(), generateId(), sectorIds)
      await repository.save(record)
      return record
    },
    async save(id, state, sectorIds) {
      const updated = lifecycle.withSavedState(await require(id), state, now(), sectorIds)
      await repository.save(updated)
      return updated
    },
    async publish(id) {
      const updated = lifecycle.publish(await require(id), now())
      await repository.save(updated)
      return updated
    },
    async archive(id) {
      const updated = lifecycle.archive(await require(id), now())
      await repository.save(updated)
      return updated
    },
    async editPublished(id) {
      const draft = lifecycle.draftFromPublished(await require(id), now(), generateId())
      // The published record is intentionally left untouched.
      await repository.save(draft)
      return draft
    },
    async reopen(id) {
      return repository.get(id)
    },
    async list() {
      return (await repository.list()).map(toSummary)
    },
    async remove(id) {
      await repository.delete(id)
    },
  }
}

/** Default repository: localStorage in the browser, in-memory on the server. */
function defaultRepository(): PlanningRepository {
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    return createLocalStoragePlanningRepository(window.localStorage)
  }
  return createInMemoryPlanningRepository()
}

/** The active planning store used by the UI. */
export const planningStore: PlanningStore = createPlanningStore(defaultRepository())
