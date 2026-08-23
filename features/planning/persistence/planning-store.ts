import type { EditorState } from "@/features/planning/editor"

import type {
  PlanningRecord,
  PlanningSummary,
} from "@/features/planning/persistence/planning-record"
import { toSummary } from "@/features/planning/persistence/planning-record"
import type { PlanningRepository } from "@/features/planning/persistence/planning-repository"
import { createInMemoryPlanningRepository } from "@/features/planning/persistence/in-memory-planning-repository"
import { createLocalStoragePlanningRepository } from "@/features/planning/persistence/local-storage-planning-repository"
import { createSupabasePlanningRepository } from "@/features/planning/persistence/planning.supabase-repository"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { createSupabaseBrowserClient } from "@/features/auth/supabase/browser"
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

/**
 * Où les plannings sont rangés : la base si elle est configurée, le navigateur
 * sinon, la mémoire quand il n'y a ni l'un ni l'autre.
 */
function defaultRepository(): PlanningRepository {
  if (typeof window === "undefined") return createInMemoryPlanningRepository()
  if (supabaseConfigured()) {
    return createSupabasePlanningRepository(createSupabaseBrowserClient())
  }
  if (typeof window.localStorage !== "undefined") {
    return createLocalStoragePlanningRepository(window.localStorage)
  }
  return createInMemoryPlanningRepository()
}

/**
 * Le dépôt actif, résolu à CHAQUE appel.
 *
 * Il était choisi une fois pour toutes au chargement du module. Sur un rendu
 * serveur, cela figeait le magasin en mémoire pour toute la vie du module — y
 * compris une fois revenu dans le navigateur, où il n'aurait plus rien
 * enregistré. Le défaut était invisible tant que la seule source était
 * `localStorage` ; avec une base derrière une session, il ne l'est plus.
 */
const lazyRepository: PlanningRepository = {
  save: (record) => defaultRepository().save(record),
  get: (id) => defaultRepository().get(id),
  list: () => defaultRepository().list(),
  delete: (id) => defaultRepository().delete(id),
}

/** The active planning store used by the UI. */
export const planningStore: PlanningStore = createPlanningStore(lazyRepository)
