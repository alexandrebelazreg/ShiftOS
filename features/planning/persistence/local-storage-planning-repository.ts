import type { PlanningRecord } from "@/features/planning/persistence/planning-record"
import type { PlanningRepository } from "@/features/planning/persistence/planning-repository"
import {
  deserializePlanning,
  serializePlanning,
} from "@/features/planning/persistence/serialization"

const KEY_PREFIX = "shiftos_planning_"
const INDEX_KEY = "shiftos_planning_index"

/**
 * localStorage-backed repository — the browser persistence so a manager's work
 * survives reloads. An id index lets `list()` enumerate records without scanning
 * every key. Same `PlanningRepository` contract as the in-memory and future
 * Supabase implementations.
 */
export function createLocalStoragePlanningRepository(storage: Storage): PlanningRepository {
  function readIndex(): string[] {
    try {
      const raw = storage.getItem(INDEX_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
    } catch {
      return []
    }
  }

  function writeIndex(ids: readonly string[]): void {
    storage.setItem(INDEX_KEY, JSON.stringify([...new Set(ids)]))
  }

  return {
    async save(record: PlanningRecord): Promise<void> {
      try {
        storage.setItem(KEY_PREFIX + record.id, serializePlanning(record))
        writeIndex([...readIndex(), record.id])
      } catch (error) {
        // Le navigateur plafonne son stockage à quelques mégaoctets, et un
        // planning enregistré en pèse plus de cent kilos. Passé une trentaine
        // de semaines, `setItem` lève — et l'exception brute (`QuotaExceededError`)
        // ne dit rien au gérant de ce qu'il doit faire.
        //
        // Traduite ici plutôt qu'à l'écran : c'est ce dépôt qui connaît la
        // cause, et l'écran ne saurait pas la distinguer d'une panne réseau.
        const full =
          error instanceof DOMException &&
          (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
        throw new Error(
          full
            ? "La mémoire de ce navigateur est pleine. Connectez Planiteo à sa base de données, ou supprimez d’anciens plannings."
            : `Enregistrement impossible dans ce navigateur : ${error instanceof Error ? error.message : String(error)}`
        )
      }
    },
    async get(id: string): Promise<PlanningRecord | null> {
      const raw = storage.getItem(KEY_PREFIX + id)
      return raw ? deserializePlanning(raw) : null
    },
    async list(): Promise<PlanningRecord[]> {
      return readIndex()
        .map((id) => storage.getItem(KEY_PREFIX + id))
        .filter((raw): raw is string => raw !== null)
        .map(deserializePlanning)
        .filter((record): record is PlanningRecord => record !== null)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    },
    async delete(id: string): Promise<void> {
      storage.removeItem(KEY_PREFIX + id)
      writeIndex(readIndex().filter((existing) => existing !== id))
    },
  }
}
