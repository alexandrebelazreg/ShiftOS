import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type { PlanningBoardInput } from "@/features/planning/board/model/board-input"
import type { EditableShift } from "@/features/planning/board/model/shift-edit"
import {
  applyShiftEdit,
  applyShiftEdits,
  canUndo,
  editedShiftCount,
  EMPTY_EDIT_STATE,
  hasEdits,
  resetShiftEdits,
  undoShiftEdit,
} from "@/features/planning/board/model/shift-edit-state"

const emp = (id: string) => id as EmployeeId

const INPUT: PlanningBoardInput = {
  periodStart: "2026-07-20",
  periodEnd: "2026-07-26",
  sectors: [{ id: "all", name: "Tous" }],
  employees: [{ id: emp("e1"), name: "Alice", sectorIds: ["all"], contractMinutes: 2100, rules: [] }],
  days: [
    { date: "2026-07-20", weekDay: "monday", closed: false, opensAtMinutes: 480, closesAtMinutes: 1200 },
  ],
  shifts: [
    {
      id: "s1",
      employeeId: emp("e1"),
      sectorId: "all",
      date: "2026-07-20",
      startMinutes: 540,
      endMinutes: 780,
      workedMinutes: 240,
      segments: [{ startMinutes: 540, endMinutes: 780 }],
      opensDay: false,
      closesDay: false,
    },
  ],
  demand: [],
}

const OPEN_SHIFT: EditableShift = {
  startMinutes: 480,
  endMinutes: 780,
  segments: [{ startMinutes: 480, endMinutes: 780 }],
}

describe("état d'édition — pile d'annulation", () => {
  it("part vide", () => {
    expect(hasEdits(EMPTY_EDIT_STATE)).toBe(false)
    expect(canUndo(EMPTY_EDIT_STATE)).toBe(false)
    expect(editedShiftCount(EMPTY_EDIT_STATE)).toBe(0)
  })

  it("enregistre une modification et permet de l'annuler", () => {
    const edited = applyShiftEdit(EMPTY_EDIT_STATE, "s1", OPEN_SHIFT)
    expect(hasEdits(edited)).toBe(true)
    expect(canUndo(edited)).toBe(true)
    expect(edited.overrides.s1.startMinutes).toBe(480)

    const undone = undoShiftEdit(edited)
    expect(hasEdits(undone)).toBe(false)
    expect(canUndo(undone)).toBe(false)
  })

  it("annule modification par modification", () => {
    const first = applyShiftEdit(EMPTY_EDIT_STATE, "s1", OPEN_SHIFT)
    const second = applyShiftEdit(first, "s1", {
      startMinutes: 510,
      endMinutes: 780,
      segments: [{ startMinutes: 510, endMinutes: 780 }],
    })
    expect(second.overrides.s1.startMinutes).toBe(510)
    // Undo lands on the first edit, not straight back to the generated state.
    const back = undoShiftEdit(second)
    expect(back.overrides.s1.startMinutes).toBe(480)
  })

  it("réinitialise toutes les modifications d'un coup", () => {
    const edited = applyShiftEdit(EMPTY_EDIT_STATE, "s1", OPEN_SHIFT)
    expect(hasEdits(resetShiftEdits())).toBe(false)
    // Reset is independent of history depth.
    expect(resetShiftEdits()).toEqual(EMPTY_EDIT_STATE)
    expect(hasEdits(edited)).toBe(true)
  })

  it("est un no-op quand il n'y a rien à annuler", () => {
    expect(undoShiftEdit(EMPTY_EDIT_STATE)).toBe(EMPTY_EDIT_STATE)
  })
})

describe("état d'édition — recalcul du planning affiché", () => {
  it("laisse l'entrée intacte sans modification", () => {
    // Same reference: an untouched board pays for no rebuild.
    expect(applyShiftEdits(INPUT, EMPTY_EDIT_STATE)).toBe(INPUT)
  })

  it("applique l'override et recalcule durée et ouverture", () => {
    const edited = applyShiftEdit(EMPTY_EDIT_STATE, "s1", OPEN_SHIFT)
    const next = applyShiftEdits(INPUT, edited)
    const shift = next.shifts.find((item) => item.id === "s1")!
    expect(shift.startMinutes).toBe(480)
    expect(shift.workedMinutes).toBe(300)
    // Dragged onto the opening hour, it is now an opening and must say so.
    expect(shift.opensDay).toBe(true)
    // The generated input is never mutated.
    expect(INPUT.shifts[0].startMinutes).toBe(540)
  })
})
