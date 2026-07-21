import type { PlanningRecord } from "@/features/planning/persistence/planning-record"
import type { PlanningRepository } from "@/features/planning/persistence/planning-repository"
import {
  deserializePlanning,
  serializePlanning,
} from "@/features/planning/persistence/serialization"

/**
 * In-memory repository — the SSR fallback and the test double. It stores the
 * SERIALIZED form (not the live object) so a round-trip through
 * serialize/deserialize is exercised on every read, exactly like a real store.
 */
export function createInMemoryPlanningRepository(): PlanningRepository {
  const store = new Map<string, string>()

  return {
    async save(record: PlanningRecord): Promise<void> {
      store.set(record.id, serializePlanning(record))
    },
    async get(id: string): Promise<PlanningRecord | null> {
      const raw = store.get(id)
      return raw ? deserializePlanning(raw) : null
    },
    async list(): Promise<PlanningRecord[]> {
      return [...store.values()]
        .map(deserializePlanning)
        .filter((record): record is PlanningRecord => record !== null)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    },
    async delete(id: string): Promise<void> {
      store.delete(id)
    },
  }
}
