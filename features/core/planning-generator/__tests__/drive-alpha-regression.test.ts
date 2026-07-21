import { describe, expect, it } from "vitest"
import type { EmployeeId } from "@/features/core/models"
import { assignmentIdFor, planningGenerator } from "@/features/core/planning-generator"
import { brand } from "@/features/core/planning-generator/__tests__/fixtures"
import { driveScenario } from "@/features/core/planning-generator/__tests__/drive-alpha-fixture"

describe("Drive alpha — 20 au 26 juillet 2026", () => {
  it("ne transmet aucune violation bloquante silencieuse à la réparation globale", () => {
    const result = planningGenerator.generate(driveScenario())
    const shifts = new Map(result.shifts.map((shift) => [shift.id, shift]))
    const employeeShifts = (id: string) => result.assignments.filter((assignment) => assignment.employeeId === brand<EmployeeId>(id)).map((assignment) => shifts.get(assignment.shiftId)!).filter(Boolean)
    const closes = (id: string, date: string) => employeeShifts(id).some((shift) => shift.date === date && shift.segments.at(-1)!.endTime === "20:00")
    const opens = (id: string, date: string) => employeeShifts(id).some((shift) => shift.date === date && shift.segments[0].startTime === "06:00")
    const minutes = (id: string) => employeeShifts(id).reduce((sum, shift) => sum + shift.segments.reduce((shiftSum, segment) => { const [startHour, startMinute] = segment.startTime.split(":").map(Number), [endHour, endMinute] = segment.endTime.split(":").map(Number); return shiftSum + endHour * 60 + endMinute - startHour * 60 - startMinute }, 0), 0)
    expect(closes("luca", "2026-07-20") && opens("luca", "2026-07-21")).toBe(false)
    expect(closes("valentin", "2026-07-22") && opens("valentin", "2026-07-23")).toBe(false)
    expect(employeeShifts("dylan").some((shift) => shift.segments[0].startTime === "06:00")).toBe(false)
    expect(employeeShifts("valentin").filter((shift) => shift.segments[0].startTime === "06:00")).toHaveLength(1)
    for (const [id, maximum] of [["luca", 1], ["valentin", 1], ["erwan", 1], ["arthur", 1], ["dylan", 2]] as const) expect(employeeShifts(id).filter((shift) => shift.segments.at(-1)!.endTime === "20:00").length).toBeLessThanOrEqual(maximum)
    expect(new Set(result.assignments.map((assignment) => assignment.shiftId)).size).toBe(result.assignments.length)
    expect(result.assignments.every((assignment) => assignment.id === assignmentIdFor(assignment.shiftId, assignment.employeeId))).toBe(true)
    expect(result.status).toBe("degraded")
    expect(["luca", "valentin", "erwan", "arthur", "dylan"].map(minutes)).toEqual([2_205, 2_205, 2_205, 2_205, 2_205])
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toHaveLength(0)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "structural_surplus", severity: "information", details: expect.objectContaining({ structuralSurplusEmployeeMinutes: 3_405, contractualEmployeeMinutes: 11_025, minimumCoverageEmployeeMinutes: 7_620 }) }))
    const minutesByDay = new Map<string, number>()
    for (const assignment of result.assignments) { const shift = shifts.get(assignment.shiftId)!; minutesByDay.set(shift.date, (minutesByDay.get(shift.date) ?? 0) + shift.segments.reduce((sum, segment) => { const [startHour, startMinute] = segment.startTime.split(":").map(Number), [endHour, endMinute] = segment.endTime.split(":").map(Number); return sum + endHour * 60 + endMinute - startHour * 60 - startMinute }, 0)) }
    expect(["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"].map((date) => minutesByDay.get(date))).toEqual([1_650, 1_650, 1_650, 1_650, 2_430, 1_995])
    expect(result.shifts.every((shift) => { const duration = shift.segments.reduce((sum, segment) => { const [startHour, startMinute] = segment.startTime.split(":").map(Number), [endHour, endMinute] = segment.endTime.split(":").map(Number); return sum + endHour * 60 + endMinute - startHour * 60 - startMinute }, 0); return duration >= 240 && duration <= 600 })).toBe(true)
    for (const id of ["luca", "valentin", "erwan", "arthur", "dylan"]) { const owned = employeeShifts(id).sort((left, right) => left.date.localeCompare(right.date)); for (let index = 1; index < owned.length; index++) { const previous = owned[index - 1], current = owned[index], previousEnd = Date.parse(`${previous.date}T${previous.segments.at(-1)!.endTime}:00Z`), currentStart = Date.parse(`${current.date}T${current.segments[0].startTime}:00Z`); expect((currentStart - previousEnd) / 60_000).toBeGreaterThanOrEqual(720) } }
    for (const date of ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"]) expect(result.shifts.filter((shift) => shift.date === date && shift.segments.at(-1)!.endTime === "20:00")).toHaveLength(1)
    for (const id of ["luca", "valentin", "erwan", "dylan"]) expect(new Set(employeeShifts(id).map((shift) => shift.date))).toEqual(new Set(["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"]))
    expect(new Set(employeeShifts("arthur").map((shift) => shift.date))).toEqual(new Set(["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-24", "2026-07-25"]))
    expect(result.weeklyAllocation?.dailyTotals.filter((day) => day.targetMinutes > 0).map((day) => day.allocatedMinutes)).toEqual([1_650, 1_650, 1_650, 1_650, 2_430, 1_995])
    expect(result.weeklyAllocation?.rows.every((row) => row.minutesByDate["2026-07-24"] > row.minutesByDate["2026-07-21"])).toBe(true)
    expect(result.coverage.statistics.underCovered).toBe(4)
    expect(result.explanations).toContainEqual(expect.objectContaining({ phase: "daily-placement", message: expect.stringContaining("Borne inférieure globale atteinte : 4 créneau(x) déficitaire(s)") }))
    expect(result.issues.some((issue) => issue.code === "closing_surplus" || issue.code === "daily_distribution_imperfect")).toBe(false)
    expect(result.repairAttempts).toHaveLength(0)
    expect(["arthur", "erwan", "luca", "valentin"].every((id) => opens(id, "2026-07-25"))).toBe(true)
    expect(result.phaseTrace).toContain("global-weekly-repair")
  }, 60_000)
})
