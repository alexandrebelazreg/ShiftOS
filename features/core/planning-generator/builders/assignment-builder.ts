import type { Assignment, Employee, Planning, Shift } from "@/features/core/models"

import type { GenerationSettings } from "@/features/core/planning-generator/types"
import { assignmentIdFor } from "@/features/core/planning-generator/builders/ids"

/**
 * Build a proposed assignment placing one employee on one shift within the
 * planning. Status is `proposed` — the generator proposes; a manager confirms.
 * Deterministic id and timestamps.
 */
export function buildAssignment(
  planning: Planning,
  shift: Shift,
  employee: Employee,
  settings: GenerationSettings
): Assignment {
  return {
    id: assignmentIdFor(shift.id, employee.id),
    planningId: planning.id,
    shiftId: shift.id,
    employeeId: employee.id,
    status: "proposed",
    createdAt: settings.now,
    updatedAt: settings.now,
  }
}
