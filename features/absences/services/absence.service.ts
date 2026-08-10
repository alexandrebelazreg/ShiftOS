import type { AbsenceRecord } from "@/features/absences/types/absence-record"

const ABSENCES_KEY = "shiftos_absences"
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Read-only dashboard access. The future Absences screen will own mutations. */
export const absenceService = {
  async list(): Promise<AbsenceRecord[]> {
    if (typeof window === "undefined") return []

    try {
      const value: unknown = JSON.parse(
        window.localStorage.getItem(ABSENCES_KEY) ?? "[]"
      )
      if (!Array.isArray(value)) return []
      return value.filter(isAbsenceRecord).map((absence) => ({ ...absence }))
    } catch {
      return []
    }
  },
}

function isAbsenceRecord(value: unknown): value is AbsenceRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>

  return (
    typeof record.id === "string" &&
    typeof record.employeeId === "string" &&
    typeof record.type === "string" &&
    record.type.trim().length > 0 &&
    typeof record.start === "string" &&
    ISO_DATE_PATTERN.test(record.start) &&
    typeof record.end === "string" &&
    ISO_DATE_PATTERN.test(record.end) &&
    record.start <= record.end &&
    (record.note === undefined || typeof record.note === "string")
  )
}
