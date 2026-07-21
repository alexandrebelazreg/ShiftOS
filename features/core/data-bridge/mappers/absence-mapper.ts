import type { Absence, IsoDateTime } from "@/features/core/models"

import type { AbsenceInput } from "@/features/core/data-bridge/types"
import { toAbsenceId, toEmployeeId } from "@/features/core/data-bridge/adapters"

/**
 * Translate a future-module absence DTO into the core `Absence`. The type is an
 * open string (defaulting to `other`); the date range is passed through. Pure
 * shape translation.
 */
export function mapAbsence(input: AbsenceInput, now: IsoDateTime): Absence {
  return {
    id: toAbsenceId(input.id),
    employeeId: toEmployeeId(input.employeeId),
    type: input.type ?? "other",
    range: { start: input.start, end: input.end },
    note: input.note,
    createdAt: now,
    updatedAt: now,
  }
}
