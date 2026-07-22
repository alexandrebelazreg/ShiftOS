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
  hasLocalChanges,
  isShiftLocked,
  lockedShiftCount,
  resetShiftEdits,
  setShiftLock,
  toggleShiftLock,
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

describe("verrous — pose et retrait", () => {
  it("verrouille un shift", () => {
    const locked = toggleShiftLock(EMPTY_EDIT_STATE, "s1")
    expect(isShiftLocked(locked, "s1")).toBe(true)
    expect(lockedShiftCount(locked)).toBe(1)
    expect(hasLocalChanges(locked)).toBe(true)
    // A lock is not a geometry edit: it neither dirties the plan nor undo.
    expect(hasEdits(locked)).toBe(false)
    expect(canUndo(locked)).toBe(false)
  })

  it("déverrouille un shift", () => {
    const locked = toggleShiftLock(EMPTY_EDIT_STATE, "s1")
    const unlocked = toggleShiftLock(locked, "s1")
    expect(isShiftLocked(unlocked, "s1")).toBe(false)
    expect(lockedShiftCount(unlocked)).toBe(0)
  })

  it("verrouille plusieurs shifts indépendamment", () => {
    let state = setShiftLock(EMPTY_EDIT_STATE, "s1", true)
    state = setShiftLock(state, "s2", true)
    expect(isShiftLocked(state, "s1")).toBe(true)
    expect(isShiftLocked(state, "s2")).toBe(true)
    expect(lockedShiftCount(state)).toBe(2)
    // Unlocking one leaves the other pinned.
    state = setShiftLock(state, "s1", false)
    expect(isShiftLocked(state, "s1")).toBe(false)
    expect(isShiftLocked(state, "s2")).toBe(true)
  })

  it("ne mute jamais l'état d'origine", () => {
    const locked = setShiftLock(EMPTY_EDIT_STATE, "s1", true)
    expect(isShiftLocked(EMPTY_EDIT_STATE, "s1")).toBe(false)
    expect(locked).not.toBe(EMPTY_EDIT_STATE)
  })
})

describe("verrous — survie aux modifications locales", () => {
  it("conserve les verrous après une édition locale", () => {
    const locked = setShiftLock(EMPTY_EDIT_STATE, "s1", true)
    const edited = applyShiftEdit(locked, "s2", OPEN_SHIFT)
    expect(isShiftLocked(edited, "s1")).toBe(true)
    expect(hasEdits(edited)).toBe(true)
  })

  it("conserve les verrous après un Undo", () => {
    const locked = setShiftLock(EMPTY_EDIT_STATE, "s1", true)
    const edited = applyShiftEdit(locked, "s2", OPEN_SHIFT)
    const undone = undoShiftEdit(edited)
    expect(isShiftLocked(undone, "s1")).toBe(true)
    // The edit is gone, the lock stays.
    expect(hasEdits(undone)).toBe(false)
  })

  it("efface les verrous après Réinitialiser", () => {
    let state = setShiftLock(EMPTY_EDIT_STATE, "s1", true)
    state = applyShiftEdit(state, "s2", OPEN_SHIFT)
    const reset = resetShiftEdits()
    expect(isShiftLocked(reset, "s1")).toBe(false)
    expect(lockedShiftCount(reset)).toBe(0)
    expect(hasLocalChanges(reset)).toBe(false)
  })
})
