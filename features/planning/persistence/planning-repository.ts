import type { PlanningRecord } from "@/features/planning/persistence/planning-record"

/**
 * PlanningRepository — the persistence boundary. It isolates the rest of the app
 * from HOW plannings are stored (in-memory, localStorage, and later Supabase),
 * exactly like `StoreRepository`. Pure storage: it holds no lifecycle rules.
 * React never talks to a repository directly — only the planning store service.
 */
export interface PlanningRepository {
  /** Insert or overwrite a record by id. */
  save(record: PlanningRecord): Promise<void>
  /** Fetch a record, or `null` if unknown / corrupt. */
  get(id: string): Promise<PlanningRecord | null>
  /** Every stored record, newest-updated first. */
  list(): Promise<PlanningRecord[]>
  /** Remove a record. */
  delete(id: string): Promise<void>
}
