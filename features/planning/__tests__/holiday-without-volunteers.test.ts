import { describe, expect, it } from "vitest"

import type { HolidayPlanEntry, IsoDate } from "@/features/core/models"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { settleHolidayDays } from "@/features/core/planning-v3/problem-builder/holiday-staffing"
import type { PlanningDayV3, PlanningEmployeeDayV3 } from "@/features/core/planning-v3/types/problem"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  employee,
  SMALL_SECTOR_SCOPE,
  smallSector,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"

/**
 * Un férié travaillé sans aucun volontaire dans le rayon : le rayon ferme ce
 * jour-là, et la semaine se génère.
 *
 * Avant : la journée restait ouverte avec sa part ordinaire de la semaine,
 * alors que personne n'avait le droit d'y travailler. Le moteur répondait
 * « jour impossible à pourvoir » et refusait toute la semaine. Mesuré sur la
 * vraie semaine Drive : chômé, aucun volontaire et deux volontaires étaient
 * refusés ; tous trois produisent maintenant un planning.
 */

const HOLIDAY = "2026-07-07" as IsoDate

function worked(volunteerIds: readonly string[]): HolidayPlanEntry {
  return { date: HOLIDAY, opening: "travaille", volunteerIds: [...volunteerIds], opensAtMinutes: 540, closesAtMinutes: 1020 }
}

function team(sector: string, prefix: string): EmployeeRecord[] {
  return [1, 2, 3].map((n) =>
    employee(`${prefix}${n}`, { weeklyHours: 24, weeklyMinutes: 1_440, sectors: [sector] } as Partial<EmployeeRecord>)
  )
}

function problemFor(options: {
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: ReturnType<typeof smallSector>[]
  readonly holidayPlan?: readonly HolidayPlanEntry[]
}) {
  const prepared = preparePlanningGeneration({
    savedPlannings: [],
    absences: [],
    store: storeConfig(),
    employees: options.employees,
    sectors: options.sectors,
    scope: SMALL_SECTOR_SCOPE,
    ...(options.holidayPlan ? { holidayPlan: options.holidayPlan } : {}),
  })
  if (prepared.status === "error") throw new Error(prepared.errors.map((e) => e.message).join(" | "))
  const built = buildPlanningProblemV3(prepared.generationInput)
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join(" | "))
  return built.problem
}

const exact = () => ({ ...smallSector(), weeklyDistributionEnabled: true })
const total = (days: readonly PlanningDayV3[]) => days.reduce((sum, day) => sum + day.budgetMinutes, 0)

describe("un férié sans volontaire dans un rayon", () => {
  it("ferme le rayon ce jour-là, sans demande à couvrir", () => {
    const problem = problemFor({ employees: team("Test", "e"), sectors: [exact()], holidayPlan: [worked([])] })
    const day = problem.days.find((entry) => entry.date === HOLIDAY)
    expect(day).toMatchObject({ closed: true, budgetMinutes: 0, opensAtMinutes: null })
    expect(problem.demandSlots.filter((slot) => slot.date === HOLIDAY)).toEqual([])
  })

  it("garde le volume de la semaine égal aux contrats, en le reportant sur les autres jours", () => {
    const problem = problemFor({ employees: team("Test", "e"), sectors: [exact()], holidayPlan: [worked([])] })
    const contracts = problem.employees.reduce((sum, entry) => sum + entry.contractMinutes, 0)
    expect(total(problem.days)).toBe(contracts)
  })

  it("ne donne aux volontaires qu'une journée ordinaire, et reporte le reste", () => {
    const problem = problemFor({ employees: team("Test", "e"), sectors: [exact()], holidayPlan: [worked(["e1"])] })
    const day = problem.days.find((entry) => entry.date === HOLIDAY)!
    const e1 = problem.employees.find((entry) => String(entry.id) === "e1")!
    const e1Days = problem.employeeDays.filter((entry) => String(entry.employeeId) === "e1" && entry.available).length
    expect(day.closed).toBe(false)
    expect(day.budgetMinutes).toBeLessThanOrEqual(Math.ceil(e1.contractMinutes / e1Days / 15) * 15)
    expect(total(problem.days)).toBe(problem.employees.reduce((sum, entry) => sum + entry.contractMinutes, 0))
  })

  it("ne touche à rien sans férié", () => {
    const plain = problemFor({ employees: team("Test", "e"), sectors: [exact()] })
    const empty = problemFor({ employees: team("Test", "e"), sectors: [exact()], holidayPlan: [] })
    expect(empty).toEqual(plain)
  })
})

describe("en zone, le rayon sans volontaire ferme seul", () => {
  it("ferme le rayon B et laisse ouvert le rayon A, qui a ses volontaires", () => {
    const a = { ...smallSector(), id: "a", name: "A", marketZone: true }
    const b = { ...smallSector(), id: "b", name: "B", marketZone: true }
    const problem = problemFor({
      employees: [...team("A", "a"), ...team("B", "b")],
      sectors: [a, b],
      holidayPlan: [worked(["a1", "a2"])],
    })
    const dayOf = (id: string) => problem.sectors?.find((s) => s.id === id)?.days.find((d) => d.date === HOLIDAY)
    expect(dayOf("a")?.closed).toBe(false)
    expect(dayOf("b")?.closed).toBe(true)
    expect(problem.demandSlots.filter((slot) => slot.date === HOLIDAY && slot.sectorId === "b")).toEqual([])
    expect(problem.days.find((d) => d.date === HOLIDAY)?.closed).toBe(false)
  })
})

describe("settleHolidayDays", () => {
  const day = (date: string, budget: number): PlanningDayV3 => ({
    date: date as IsoDate, weekDay: "monday", weekKey: "2026-W28", closed: false,
    opensAtMinutes: 540, closesAtMinutes: 1020, budgetMinutes: budget,
  })

  it("répartit au plus fort reste : des jours égaux restent égaux", () => {
    const days = [day("d1", 450), day("d2", 450), day("d3", 450), day("h", 450)]
    const settled = settleHolidayDays(days, [] as PlanningEmployeeDayV3[], new Map([["h", { share: 450, chome: false }]]), new Map(), 15)
    expect(settled.days.map((entry) => entry.budgetMinutes)).toEqual([600, 600, 600, 0])
    expect(settled.closedDates.has("h")).toBe(true)
  })

  it("ne fait rien sans férié", () => {
    const days = [day("d1", 600)]
    expect(settleHolidayDays(days, [], new Map(), new Map(), 15).days).toEqual(days)
  })
})
