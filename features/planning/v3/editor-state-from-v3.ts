import type { Assignment, AssignmentId, Shift, ShiftId, TimeString } from "@/features/core/models"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type { PlanningInput } from "@/features/core/data-bridge"
import type { GenerationSettings } from "@/features/core/planning-generator"
import { buildEmptyPlanning } from "@/features/core/planning-generator"
import type { StoreConfiguration } from "@/features/store/models"

import { createEditorState, type EditorState } from "@/features/planning/editor"
import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"

/**
 * A V3 solution, re-expressed as the editor state the whole screen already
 * speaks.
 *
 * The alternative was a second rendering path for V3 — a board fed directly
 * from `PlanningSolutionV3`, its own editor, its own persistence. That would
 * have doubled the surface where V2 and V3 can disagree about what a schedule
 * looks like, for a mode that is explicitly experimental. Translating once,
 * here, means the board, the detailed editor, the indicators, the publish gate
 * and the saved-planning list all keep working with no idea which engine ran.
 *
 * TEMPORARY, and worth naming precisely: a V3 assignment carries no shift
 * identity, so the ids below are MINTED from the employee and the date. They
 * are stable for a given schedule — the same solution always produces the same
 * ids — but they are not the ids V2 would have produced for a similar shift,
 * and they do not survive a change of employee or day. Locking a shift, saving,
 * and regenerating works; comparing ids across engines does not.
 */

function brand<T>(value: string): T {
  return value as unknown as T
}

/** Minutes since midnight → `HH:mm`. The model stores times as strings. */
function toTimeString(minutes: number): TimeString {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}` as TimeString
}

/** Stable id for one V3 assignment: employee + date, which is its identity. */
export function v3ShiftId(employeeId: string, date: string): ShiftId {
  return brand<ShiftId>(`shift_v3_${employeeId}_${date}`)
}

export interface V3EditorStateInput {
  readonly solution: PlanningSolutionV3
  readonly coreInput: PlanningInput
  readonly configuration: StoreConfiguration
  readonly settings: GenerationSettings
}

export function editorStateFromV3Solution(input: V3EditorStateInput): EditorState {
  const { shifts, assignments } = v3ShiftsAndAssignments(input)
  return createEditorState({
    coreInput: input.coreInput,
    configuration: input.configuration,
    // Same builder V2 uses, from the same settings: identity, scope and
    // provenance are described once, not twice.
    planning: buildEmptyPlanning(input.coreInput.store.id, input.settings),
    shifts,
    assignments,
  })
}

export function v3ShiftsAndAssignments(input: V3EditorStateInput): {
  readonly shifts: readonly Shift[]
  readonly assignments: readonly Assignment[]
} {
  const shifts: Shift[] = []
  const assignments: Assignment[] = []
  const now = input.settings.now

  for (const assignment of input.solution.assignments) {
    const employeeId = String(assignment.employeeId)
    const shiftId = v3ShiftId(employeeId, assignment.date)

    shifts.push({
      id: shiftId,
      storeId: input.coreInput.store.id,
      // Never from the shift library: V3 chooses start and duration freely
      // inside the legal space, so claiming a template would be a false
      // provenance.
      templateId: null,
      date: assignment.date,
      source: "dynamic",
      segments: assignment.segments.map((segment) => ({
        startTime: toTimeString(segment.startMinutes),
        endTime: toTimeString(segment.endMinutes),
      })),
      createdAt: now,
      updatedAt: now,
    })

    assignments.push({
      id: brand<AssignmentId>(`assignment_${shiftId}_${employeeId}`),
      planningId: input.settings.planningId,
      shiftId,
      employeeId: assignment.employeeId,
      // `proposed`, not `confirmed`: nothing has been published, and V3 is the
      // experimental engine. Confirmation is the publish step's business.
      status: "proposed",
      createdAt: now,
      updatedAt: now,
    })
  }

  return { shifts, assignments }
}

/**
 * The schedule on screen, as the reference a regeneration is measured against.
 *
 * Reads the editor state rather than the original solution so it carries the
 * manager's local edits too — which is exactly what a lock or a stability
 * objective must refer to. `shiftId` here is the ASSIGNMENT id, matching what
 * the board hands to `buildRegenerationRequest`, so a lock taken from the UI
 * resolves against this baseline without translation.
 */
export function baselineFromEditorState(state: EditorState): PlanningBaselineV3 {
  const shiftById = new Map(state.shifts.map((shift) => [shift.id, shift]))

  const shifts = state.assignments.flatMap((assignment) => {
    const shift = shiftById.get(assignment.shiftId)
    if (shift === undefined) return []
    const segments = shift.segments
      .map((segment) => ({
        startMinutes: minutesOf(segment.startTime),
        endMinutes: minutesOf(segment.endTime),
      }))
      .sort((left, right) => left.startMinutes - right.startMinutes)
    if (segments.length === 0) return []
    return [
      {
        shiftId: String(assignment.id),
        employeeId: assignment.employeeId,
        date: shift.date,
        segments,
      },
    ]
  })

  return { shifts }
}

function minutesOf(value: string): number {
  const [hours, minutes] = value.split(":").map(Number)
  return hours * 60 + minutes
}
