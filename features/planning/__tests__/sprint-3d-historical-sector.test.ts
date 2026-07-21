import { describe, expect, it } from "vitest"

import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { runPlanningFlow } from "@/features/planning/flow"
import { createEmptySector, createSectorRepository } from "@/features/sectors"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

const DATES = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"]
const PROFILES = [
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1], [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1], [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 1, 3, 1, 4, 1, 1, 1, 1, 1, 3, 2, 1, 1], [4, 1, 1, 1, 1, 4, 1, 1, 1, 1, 1, 1, 1, 1],
] as const

const store = {
  name: "Drive", address: "1 rue du Drive", city: "Paris", postalCode: "75001", country: "France", timezone: "Europe/Paris",
  openingHours: WEEK_DAYS.map((day) => ({ day, closed: day === "sunday", opensAt: day === "sunday" ? "" : "06:00", closesAt: day === "sunday" ? "" : "20:00" })),
  planningMode: "dynamic", minShiftDuration: 240, maxShiftDuration: 600, timeGranularity: 15, splitShiftPolicy: "allowed",
  minSplitDuration: 15, maxSplitDuration: 90, maxSplitShiftsPerWeek: 6, minDailyHours: 4, maxDailyHours: 10, minRestBetweenShifts: 12,
} as StoreConfig

function employee(id: string, workingDays: readonly WeekDay[], limits: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    id, firstName: id, lastName: "Drive", phone: "", email: `${id}@drive.test`, status: "active", weeklyHours: 36.75, weeklyMinutes: 2_205,
    workingDays: [...workingDays], contractType: "full_time", canOpen: id !== "dylan", canClose: true, splitShiftAllowed: id === "arthur",
    fixedDaysOff: WEEK_DAYS.filter((day) => !workingDays.includes(day)), forbiddenDays: [], maxOpenings: null, maxClosings: null,
    preferOpening: false, preferClosing: false, sectors: ["Drive"], competencies: {}, notes: "", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
    ...limits,
  } as EmployeeRecord
}

describe("Sprint 3D — migration repository vers planning réel", () => {
  it("ne régresse jamais silencieusement vers les placeurs V2", () => {
    const base = createEmptySector("drive")
    const historical = {
      ...base, name: "Drive", weeklyDistribution: { monday: 15, tuesday: 15, wednesday: 15, thursday: 15, friday: 22, saturday: 18, sunday: 0 },
      hours: WEEK_DAYS.map((day) => ({ day, closed: day === "sunday", opensAt: "06:00", closesAt: "20:00" })),
      coverage: { standardDay: "monday", profiles: Object.fromEntries(DATES.map((_, index) => [WEEK_DAYS[index], PROFILES[index].map((employees, slot) => ({ start: `${String(6 + slot).padStart(2, "0")}:00`, end: `${String(7 + slot).padStart(2, "0")}:00`, employees }))])) },
      shiftRules: { ...base.shiftRules, maximumDailyDuration: 600, splitShiftAllowed: true, maximumSplitDuration: 90 },
    } as Record<string, unknown>
    delete historical.workEveryNonFixedRestDay
    const repository = createSectorRepository({ getItem: () => JSON.stringify([historical]), setItem: () => undefined })
    const sectors = repository.list()
    expect(sectors[0].workEveryNonFixedRestDay).toBe(true)

    const allOpen = WEEK_DAYS.filter((day) => day !== "sunday")
    const result = runPlanningFlow({
      store,
      employees: [employee("luca", allOpen, { maxClosings: 1 }), employee("valentin", allOpen, { maxOpenings: 1, maxClosings: 1 }), employee("erwan", allOpen, { maxClosings: 1 }), employee("arthur", ["monday", "tuesday", "wednesday", "friday", "saturday"], { maxClosings: 1 }), employee("dylan", allOpen, { maxClosings: 2 })],
      sectors,
      scope: { planningId: "drive_historical", period: { start: DATES[0], end: "2026-07-26" }, now: "2026-07-01T00:00:00.000Z" },
    })
    expect(result.status).toBe("success")
    if (result.status !== "success") return
    const generation = result.generation
    expect(generation.weeklyAllocation).toBeDefined()
    expect(generation.phaseTrace).toEqual(expect.arrayContaining(["weekly-allocation", "daily-placement"]))
    expect(generation.explanations.some((item) => ["closing-assignment", "coverage", "contract-completion"].includes(item.phase))).toBe(false)
    expect(generation.weeklyAllocation!.dailyTotals.filter((day) => day.targetMinutes > 0).map((day) => day.allocatedMinutes)).toEqual([1_650, 1_650, 1_650, 1_650, 2_430, 1_995])
    expect(generation.weeklyAllocation!.rows.every((row) => DATES.every((date) => String(row.employeeId) === "arthur" && date === "2026-07-23" ? row.minutesByDate[date] === 0 : row.minutesByDate[date] > 0))).toBe(true)
  }, 120_000)
})
