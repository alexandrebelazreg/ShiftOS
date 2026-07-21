import { describe, expect, it } from "vitest"

import { WEEK_DAYS } from "@/features/core/models"
import type { ShiftId } from "@/features/core/models"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

import { runPlanningFlow } from "@/features/planning/flow"
import { createEditorState, deleteShift, type EditorState } from "@/features/planning/editor"
import {
  canEdit,
  createInMemoryPlanningRepository,
  createPlanningStore,
  type PlanningStore,
} from "@/features/planning/persistence"

const NOW = "2026-07-01T00:00:00.000Z"
const WEEKEND = new Set(["saturday", "sunday"])

function storeConfig(): StoreConfig {
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
  } as StoreConfig
}

function employee(id: string): EmployeeRecord {
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
  }
}

function generateEditorState(): EditorState {
  const result = runPlanningFlow({
    store: storeConfig(),
    employees: [employee("e1"), employee("e2")],
    scope: { planningId: "planning_1", period: { start: "2026-07-06", end: "2026-07-12" }, now: NOW },
  })
  if (result.status !== "success") throw new Error("generation failed")
  return createEditorState({
    coreInput: result.coreInput,
    configuration: result.configuration,
    planning: result.generation.planning,
    shifts: result.generation.shifts,
    assignments: result.generation.assignments,
  })
}

function makeStore(): PlanningStore {
  let counter = 0
  return createPlanningStore(createInMemoryPlanningRepository(), {
    now: () => NOW,
    generateId: () => `rec_${++counter}`,
  })
}

describe("planning persistence", () => {
  it("saves a planning and lists it as a draft", async () => {
    const store = makeStore()
    const record = await store.createDraft(generateEditorState())

    expect(record.status).toBe("draft")
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(record.id)
    expect(list[0].status).toBe("draft")
  })

  it("reopens a planning and fully restores the editor state", async () => {
    const store = makeStore()
    const original = generateEditorState()
    const record = await store.createDraft(original)

    const reopened = await store.reopen(record.id)
    expect(reopened).not.toBeNull()
    // A JSON round-trip restored the complete editor state, byte-for-byte.
    expect(reopened!.state).toEqual(original)
    expect(reopened!.state.shifts).toHaveLength(original.shifts.length)
    expect(reopened!.state.assignments).toHaveLength(original.assignments.length)
    expect(reopened!.state.coreInput.employees).toHaveLength(original.coreInput.employees.length)
  })

  it("continues editing a draft: saving an edit persists the new state", async () => {
    const store = makeStore()
    const state = generateEditorState()
    const record = await store.createDraft(state)

    const edited = deleteShift(state, state.shifts[0].id as ShiftId)
    const saved = await store.save(record.id, edited)
    expect(saved.state.shifts).toHaveLength(state.shifts.length - 1)

    const reopened = await store.reopen(record.id)
    expect(reopened!.state.shifts).toHaveLength(state.shifts.length - 1)
  })

  it("makes a published planning read-only", async () => {
    const store = makeStore()
    const state = generateEditorState()
    const record = await store.createDraft(state)

    const published = await store.publish(record.id)
    expect(published.status).toBe("published")
    expect(canEdit(published)).toBe(false)
    // Saving into a published planning is rejected — it is never modified.
    await expect(store.save(record.id, state)).rejects.toThrow(/read-only/i)
  })

  it("editing a published planning creates a new draft, leaving the original", async () => {
    const store = makeStore()
    const record = await store.createDraft(generateEditorState())
    await store.publish(record.id)

    const draft = await store.editPublished(record.id)
    expect(draft.id).not.toBe(record.id)
    expect(draft.status).toBe("draft")
    // The published original is untouched.
    const original = await store.reopen(record.id)
    expect(original!.status).toBe("published")
    expect((await store.list())).toHaveLength(2)
  })

  it("makes an archived planning read-only but still readable", async () => {
    const store = makeStore()
    const state = generateEditorState()
    const record = await store.createDraft(state)

    await store.publish(record.id)
    const archived = await store.archive(record.id)
    expect(archived.status).toBe("archived")
    expect(canEdit(archived)).toBe(false)
    await expect(store.save(record.id, state)).rejects.toThrow(/read-only/i)
    // Still fully readable.
    const reopened = await store.reopen(record.id)
    expect(reopened!.state.shifts.length).toBeGreaterThan(0)
  })

  it("rejects illegal lifecycle transitions", async () => {
    const store = makeStore()
    const record = await store.createDraft(generateEditorState())
    await expect(store.archive(record.id)).rejects.toThrow()
    await store.publish(record.id)
    await store.archive(record.id)
    // Archived is terminal — cannot be published.
    await expect(store.publish(record.id)).rejects.toThrow()
  })
})
