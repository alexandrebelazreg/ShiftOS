import type { PlanningRecord, PlanningStatus } from "@/features/planning/persistence/planning-record"
import { PLANNING_STATUSES } from "@/features/planning/persistence/planning-record"

/**
 * Serialization of a persisted planning. The `EditorState` is plain data (ISO
 * string timestamps, no functions / Maps / Dates), so a JSON round-trip is
 * lossless. A `version` guards against restoring an incompatible shape.
 */
const SERIALIZATION_VERSION = 1

interface SerializedEnvelope {
  readonly version: number
  readonly record: PlanningRecord
}

export function serializePlanning(record: PlanningRecord): string {
  const envelope: SerializedEnvelope = { version: SERIALIZATION_VERSION, record }
  return JSON.stringify(envelope)
}

/**
 * Restore a record from its serialized form. A corrupt, truncated or
 * incompatible payload yields `null` (treated as "not found") rather than
 * throwing — no manager work crashes the app.
 */
export function deserializePlanning(raw: string): PlanningRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isEnvelope(parsed) || parsed.version !== SERIALIZATION_VERSION) return null
  return isValidRecord(parsed.record) ? parsed.record : null
}

function isEnvelope(value: unknown): value is SerializedEnvelope {
  return typeof value === "object" && value !== null && "version" in value && "record" in value
}

/** Structural check that the restored record carries a complete editor state. */
function isValidRecord(value: unknown): value is PlanningRecord {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== "string") return false
  if (!PLANNING_STATUSES.includes(record.status as PlanningStatus)) return false
  const state = record.state as Record<string, unknown> | undefined
  if (!state) return false
  return (
    "coreInput" in state &&
    "configuration" in state &&
    "planning" in state &&
    "settings" in state &&
    Array.isArray(state.shifts) &&
    Array.isArray(state.assignments)
  )
}
