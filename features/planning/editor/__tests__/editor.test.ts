import { describe, expect, it } from "vitest"

import { WEEK_DAYS } from "@/features/core/models"
import type { EmployeeId, ShiftId } from "@/features/core/models"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

import { editorStateFixture } from "@/features/planning/__tests__/editor-state-fixture"
import {
  buildEmployeeSummary,
  buildSectorGrid,
  deleteShift,
  editShiftTime,
  evaluateEditor,
  moveShift,
  swapEmployees,
  type EditorState,
} from "@/features/planning/editor"

const NOW = "2026-07-01T00:00:00.000Z"
const WEEKEND = new Set(["saturday", "sunday"])
const MON = "2026-07-06"

function storeConfig(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return {
    name: "Test Store",
    address: "1 rue de Test",
    city: "Paris",
    postalCode: "75001",
    country: "France",
    timezone: "Europe/Paris",
    openingHours: WEEK_DAYS.map((day) =>
      WEEKEND.has(day)
        ? { day, closed: true, opensAt: "", closesAt: "" }
        : { day, closed: false, opensAt: "09:00", closesAt: "17:00" }
    ),
    planningMode: "dynamic",
    minShiftDuration: 120,
    maxShiftDuration: 600,
    timeGranularity: 60,
    splitShiftPolicy: "forbidden",
    minSplitDuration: undefined,
    maxSplitDuration: undefined,
    maxSplitShiftsPerWeek: undefined,
    minDailyHours: 2,
    maxDailyHours: 10,
    minRestBetweenShifts: 11,
    maxWeeklyHoursOverride: undefined,
    ...overrides,
  } as StoreConfig
}

function employee(id: string, overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    id,
    firstName: id,
    lastName: "Test",
    phone: "",
    email: `${id}@example.test`,
    status: "active",
    weeklyHours: 35,
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    contractType: "full_time",
    canOpen: true,
    canClose: true,
    splitShiftAllowed: false,
    fixedDaysOff: [],
    forbiddenDays: [],
    maxOpenings: null,
    maxClosings: null,
    preferOpening: false,
    preferClosing: false,
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const SCOPE = { planningId: "planning_1", period: { start: MON, end: "2026-07-12" }, now: NOW }

/** Generate a planning and open it in the editor. */
function openEditor(employees: EmployeeRecord[]): EditorState {
  return editorStateFixture({ store: storeConfig(), employees, scope: SCOPE })
}

const brand = <T>(v: string): T => v as unknown as T

describe("planning editor — live evaluation", () => {
  it("opens a generated planning and evaluates it (green when valid)", () => {
    const state = openEditor([employee("e1"), employee("e2")])
    const evaluation = evaluateEditor(state)

    expect(evaluation.constraintReport.feasible).toBe(true)
    expect(evaluation.indicators.coverage).toBe(1)
    expect(evaluation.level).toBe("green")
    expect(evaluation.canPublish).toBe(true)
    expect(evaluation.statistics.employees).toHaveLength(2)
  })

  it("re-evaluates live after deleting a shift (coverage degrades → orange)", () => {
    const state = openEditor([employee("e1"), employee("e2")])
    const before = evaluateEditor(state)
    expect(before.level).toBe("green")

    // Employee shifts are now independent; one deletion may legitimately leave
    // the slot covered by another employee. Remove each individual shift to
    // create an unambiguous coverage deficit for this editor regression.
    const edited = state.shifts.reduce((current, shift) => deleteShift(current, shift.id as ShiftId), state)
    const after = evaluateEditor(edited)

    expect(edited.shifts).toHaveLength(0)
    expect(after.coverage.statistics.underCovered).toBeGreaterThan(0)
    expect(after.level).toBe("orange") // coverage degraded, still editable
    expect(after.canPublish).toBe(true)
    // The two evaluations differ → the update was live.
    expect(after.indicators.coverage).toBeLessThan(before.indicators.coverage)
  })

  it("swaps two employees' assignments (both views reflect the one planning)", () => {
    const state = openEditor([employee("e1"), employee("e2")])
    const a = state.assignments[0]
    const b = state.assignments.find((x) => x.employeeId !== a.employeeId)!

    const swapped = swapEmployees(state, a.id, b.id)
    const newA = swapped.assignments.find((x) => x.shiftId === a.shiftId)!
    const newB = swapped.assignments.find((x) => x.shiftId === b.shiftId)!
    expect(newA.employeeId).toBe(b.employeeId)
    expect(newB.employeeId).toBe(a.employeeId)
    // Still one planning, same number of assignments.
    expect(swapped.assignments).toHaveLength(state.assignments.length)
  })

  it("moves a shift to another day", () => {
    const state = openEditor([employee("e1")])
    const shiftId = state.shifts[0].id as ShiftId
    const originalDate = state.shifts[0].date

    const moved = moveShift(state, shiftId, "2026-07-09")
    expect(moved.shifts.find((s) => s.id === shiftId)!.date).toBe("2026-07-09")
    expect(originalDate).not.toBe("2026-07-09")
  })

  it("edits a shift's time and reflects the new hours", () => {
    const state = openEditor([employee("e1")])
    const shiftId = state.shifts[0].id as ShiftId

    const edited = editShiftTime(state, shiftId, 0, { startTime: "09:00", endTime: "12:00" })
    const summary = buildEmployeeSummary(edited, evaluateEditor(edited), brand<EmployeeId>("e1"))!
    const shortShift = summary.shifts.find((s) => s.shiftId === shiftId)!
    expect(shortShift.start).toBe("09:00")
    expect(shortShift.end).toBe("12:00")
    expect(shortShift.hours).toBe(3)
  })

  it("flags an over-contract employee as yellow", () => {
    // Generation never creates an over-contract plan; simulate a manager-side
    // contract reduction to keep the editor's live warning regression covered.
    const generated = openEditor([employee("e1"), employee("e2")])
    const state = { ...generated, coreInput: { ...generated.coreInput, contracts: generated.coreInput.contracts.map((item) => item.employeeId === brand<EmployeeId>("e1") ? { ...item, weeklyMinutes: 60, weeklyHours: 1 } : item) } }
    const evaluation = evaluateEditor(state)
    const grid = buildSectorGrid(state, evaluation)
    const e1Row = grid.rows.find((r) => r.employeeId === brand<EmployeeId>("e1"))!
    expect(e1Row.plannedHours).toBeGreaterThan(e1Row.contractHours)
    expect(e1Row.level).toBe("yellow")
  })

  it("builds a sector grid with per-day coverage headers", () => {
    const state = openEditor([employee("e1"), employee("e2")])
    const grid = buildSectorGrid(state, evaluateEditor(state))

    expect(grid.days).toHaveLength(7) // Mon–Sun
    const monday = grid.days.find((d) => d.date === MON)!
    expect(monday.coverageRate).toBe(1)
    expect(monday.level).toBe("green")
    // Closed weekend days have nothing to cover → treated as green.
    expect(grid.days.find((d) => d.weekDay === "sunday")!.level).toBe("green")
    expect(grid.rows).toHaveLength(2)
  })

  it("builds an employee summary with contract balance and counts", () => {
    const state = openEditor([employee("e1"), employee("e2")])
    const summary = buildEmployeeSummary(state, evaluateEditor(state), brand<EmployeeId>("e1"))!

    expect(summary.contractHours).toBe(35)
    expect(summary.plannedHours).toBeGreaterThan(0)
    expect(summary.differenceHours).toBe(summary.plannedHours - 35)
    expect(typeof summary.saturdayCount).toBe("number")
    expect(summary.shifts.length).toBeGreaterThan(0)
  })

  it("editing is deterministic (same edit → same evaluation)", () => {
    const build = () => {
      const state = openEditor([employee("e1"), employee("e2")])
      const edited = deleteShift(state, state.shifts[0].id as ShiftId)
      const evaluation = evaluateEditor(edited)
      return {
        level: evaluation.level,
        coverage: evaluation.indicators.coverage,
        quality: evaluation.indicators.quality,
        assignments: edited.assignments,
      }
    }
    expect(build()).toEqual(build())
  })
})
