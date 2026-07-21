import { describe, expect, it } from "vitest"
import { constraintEvaluator } from "@/features/core/constraint-engine"
import type { Assignment, EmployeeId, Shift, ShiftId } from "@/features/core/models"
import { buildAssignment, buildEmptyPlanning, repairWeeklyPlan, type GenerationContext } from "@/features/core/planning-generator"
import { brand } from "@/features/core/planning-generator/__tests__/fixtures"
import { driveScenario } from "@/features/core/planning-generator/__tests__/drive-alpha-fixture"

const DATES = ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"]

function seededRepairProblem() {
  const input = driveScenario(), planning = buildEmptyPlanning(input.store.id, input.settings)
  const contracts = (input.contracts ?? []).map((contract) => ({ ...contract, weeklyHours: 36.5, weeklyMinutes: 2_190 }))
  const context: GenerationContext = { store: input.store, employees: input.employees, demand: input.demand, settings: input.settings, planning, registry: input.registry, evaluator: constraintEvaluator, contracts, availabilityRules: input.availabilityRules ?? [], absences: input.absences ?? [], holidays: input.holidays ?? [], employeeConstraints: input.employeeConstraints ?? [], business: input.business ?? {} }
  const durations: Record<string, readonly number[]> = {
    arthur: [408, 408, 408, 408, 408, 408],
    dylan: [365, 365, 365, 365, 365, 365],
    erwan: [365, 365, 365, 365, 365, 365],
    luca: [395, 395, 395, 365, 365, 365],
    valentin: [395, 395, 395, 365, 365, 365],
  }
  const shifts: Shift[] = [], assignments: Assignment[] = []
  for (const employee of input.employees) for (const [index, date] of DATES.entries()) {
    const employeeContract = context.contracts.find((contract) => contract.employeeId === employee.id)!
    const day = context.store.openingHours.find((hours) => hours.day === (["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[index])!.day
    if (!employeeContract.workingDays.includes(day)) continue
    const duration = durations[String(employee.id)][index], end = 8 * 60 + duration
    const shift: Shift = { id: brand<ShiftId>(`seed_${employee.id}_${date}`), storeId: input.store.id, templateId: null, date, source: "dynamic", segments: [{ startTime: "08:00", endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` }], createdAt: input.settings.now, updatedAt: input.settings.now }
    shifts.push(shift); assignments.push(buildAssignment(planning, shift, employee, input.settings))
  }
  return { context, shifts, assignments }
}

function minutesFor(shifts: readonly Shift[], assignments: readonly Assignment[], employeeId: string) {
  const ids = new Set(assignments.filter((assignment) => assignment.employeeId === brand<EmployeeId>(employeeId)).map((assignment) => assignment.shiftId))
  return shifts.filter((shift) => ids.has(shift.id)).reduce((sum, shift) => sum + shift.segments.reduce((subtotal, segment) => { const [startHour, startMinute] = segment.startTime.split(":").map(Number), [endHour, endMinute] = segment.endTime.split(":").map(Number); return subtotal + endHour * 60 + endMinute - startHour * 60 - startMinute }, 0), 0)
}

describe("global weekly repair", () => {
  it("répare atomiquement les vrais écarts +90/+90/-150", () => {
    const problem = seededRepairProblem(), first = repairWeeklyPlan(problem.context, [], problem.shifts, problem.assignments), second = repairWeeklyPlan(problem.context, [], problem.shifts, problem.assignments)
    expect(["luca", "valentin", "arthur", "erwan", "dylan"].map((id) => minutesFor(problem.shifts, problem.assignments, id) - 2_190)).toEqual([90, 90, -150, 0, 0])
    expect(first.before.slice(0, 3)).toEqual([0, 3, 330])
    expect(first.after.slice(0, 3)).toEqual([0, 0, 0])
    expect(["luca", "valentin", "arthur", "erwan", "dylan"].map((id) => minutesFor(first.shifts, first.assignments, id))).toEqual([2_190, 2_190, 2_190, 2_190, 2_190])
    expect(first.shifts.every((shift) => minutesFor([shift], first.assignments, String(first.assignments.find((assignment) => assignment.shiftId === shift.id)?.employeeId)) >= 240)).toBe(true)
    expect(first.shifts).toEqual(second.shifts)
    expect(first.assignments).toEqual(second.assignments)
    expect(first.repairAttempts).toContainEqual(expect.objectContaining({ family: "coordinated-portions", generated: expect.any(Number), evaluated: expect.any(Number), accepted: expect.any(Number) }))
  }, 30_000)

  it("conserve et explore les plateaux déterministes", () => {
    const problem = seededRepairProblem()
    const exact = repairWeeklyPlan(problem.context, [], problem.shifts, problem.assignments)
    const plateau = repairWeeklyPlan(problem.context, [], exact.shifts, exact.assignments)
    expect(plateau.before).toEqual(plateau.after)
    expect(plateau.repairAttempts.some((attempt) => attempt.family === "exchange-complete-shifts" && attempt.accepted > 0)).toBe(true)
    expect(plateau.shifts).toEqual(exact.shifts)
  }, 30_000)
})
