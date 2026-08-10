import type { AbsenceType } from "@/features/core/models"

/** Persisted application record used by the dashboard and the future absence screen. */
export interface AbsenceRecord {
  readonly id: string
  readonly employeeId: string
  readonly type: AbsenceType
  readonly start: string
  readonly end: string
  readonly note?: string
}
