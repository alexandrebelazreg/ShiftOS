import { describe, expect, it } from "vitest"

import type { HolidayPlanEntry, IsoDate } from "@/features/core/models"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { dailyCeilingMinutes, settleHolidayDays } from "@/features/core/planning-v3/problem-builder/holiday-staffing"
import { dayRolesOf, type PlanningDayV3, type PlanningEmployeeDayV3 } from "@/features/core/planning-v3/types/problem"
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

describe("un férié à un seul volontaire", () => {
  // Un volontaire ne peut pas ouvrir ET fermer : la règle « un ouvreur, un
  // fermeur distincts » rendait la semaine impossible. L'ouverture passe
  // d'abord, la fermeture n'est plus exigée ce jour-là.
  const problem = problemFor({ employees: team("Test", "e"), sectors: [exact()], holidayPlan: [worked(["e1"])] })
  const day = problem.days.find((entry) => entry.date === HOLIDAY)!

  it("garde l'ouverture et n'exige plus de fermeur ce jour-là", () => {
    expect(dayRolesOf(day, problem.rules)).toEqual({ openings: 1, closings: 0 })
  })

  it("ne touche pas aux rôles des autres jours", () => {
    for (const other of problem.days.filter((entry) => entry.date !== HOLIDAY)) {
      expect("minimumOpenings" in other).toBe(false)
      expect("exactClosings" in other).toBe(false)
    }
  })

  it("garde les deux rôles quand deux volontaires peuvent les tenir", () => {
    const two = problemFor({ employees: team("Test", "e"), sectors: [exact()], holidayPlan: [worked(["e1", "e2"])] })
    const holiday = two.days.find((entry) => entry.date === HOLIDAY)!
    expect("minimumOpenings" in holiday).toBe(false)
    expect(dayRolesOf(holiday, two.rules)).toEqual({ openings: 1, closings: 1 })
  })

  it("ne pose aucun plancher dur un férié", () => {
    expect(problem.demandSlots.filter((slot) => slot.date === HOLIDAY && slot.hardMinimumEmployees !== undefined)).toEqual([])
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

describe("le férié ne demande jamais plus que ce que le moteur juge faisable", () => {
  // Le message reçu le 11/11/2026 : « le budget impose 9 h de travail, mais
  // les 2 salariés disponibles peuvent fournir au maximum 8 h 15 ». En zone,
  // le budget du jour se recalcule pour toute la zone à partir du besoin des
  // comptoirs, et ce calcul ignorait les volontaires : le férié gardait sa part
  // ordinaire de six personnes pour deux présentes.
  const zone = () => {
    const a = { ...smallSector(), id: "a", name: "A", marketZone: true, weeklyDistributionEnabled: true }
    const b = { ...smallSector(), id: "b", name: "B", marketZone: true, weeklyDistributionEnabled: true }
    return problemFor({
      employees: [...team("A", "a"), ...team("B", "b")],
      sectors: [a, b],
      holidayPlan: [worked(["a1", "b1"])],
    })
  }

  it("plafonne la journée fériée de la zone à la capacité réelle des volontaires", () => {
    const problem = zone()
    const day = problem.days.find((entry) => entry.date === HOLIDAY)!
    const present = problem.employeeDays.filter((entry) => entry.date === HOLIDAY && entry.available)
    const ceilings = present.reduce((sum, entry) => {
      const employee = problem.employees.find((other) => other.id === entry.employeeId)!
      return sum + dailyCeilingMinutes(employee, entry, problem.rules)
    }, 0)
    expect(present).toHaveLength(2)
    expect(day.budgetMinutes).toBeGreaterThan(0)
    expect(day.budgetMinutes).toBeLessThanOrEqual(ceilings)
  })

  it("garde le volume de la zone égal aux contrats", () => {
    const problem = zone()
    expect(total(problem.days)).toBe(problem.employees.reduce((sum, entry) => sum + entry.contractMinutes, 0))
  })
})

describe("settleHolidayDays", () => {
  const RULES = problemFor({ employees: team("Test", "e"), sectors: [exact()] }).rules

  const day = (date: string, budget: number): PlanningDayV3 => ({
    date: date as IsoDate, weekDay: "monday", weekKey: "2026-W28", closed: false,
    opensAtMinutes: 540, closesAtMinutes: 1020, budgetMinutes: budget,
  })

  it("répartit au plus fort reste : des jours égaux restent égaux", () => {
    const days = [day("d1", 450), day("d2", 450), day("d3", 450), day("h", 450)]
    const settled = settleHolidayDays(days, [] as PlanningEmployeeDayV3[], new Map([["h", { share: 450, chome: false }]]), [], RULES, 15)
    expect(settled.days.map((entry) => entry.budgetMinutes)).toEqual([600, 600, 600, 0])
    expect(settled.closedDates.has("h")).toBe(true)
  })

  it("ne fait rien sans férié", () => {
    const days = [day("d1", 600)]
    expect(settleHolidayDays(days, [], new Map(), [], RULES, 15).days).toEqual(days)
  })
})

describe("dailyCeilingMinutes, copie de _daily_ceiling", () => {
  // Les mêmes cas que tests/test_split_ceiling.py côté moteur : si l'une des
  // deux copies bouge seule, l'un des deux fichiers le dira.
  const rules = {
    maximumShiftMinutes: 600, maximumContinuousMinutes: 480,
    splitShiftAllowed: true, maximumSplitsPerDay: 1, minimumSplitMinutes: 45,
  }
  const entry = (start: number, end: number) => ({ earliestStartMinutes: start, latestEndMinutes: end, maximumMinutes: end - start })
  const splitter = { maximumDailyMinutes: 600, canSplitShift: true }

  it("garde à une journée courte son plafond sans coupure", () => {
    expect(dailyCeilingMinutes(splitter, entry(510, 780), rules)).toBe(270)
  })

  it("compte toujours la coupure sur une journée ordinaire", () => {
    expect(dailyCeilingMinutes(splitter, entry(360, 1200), rules)).toBe(600)
    expect(dailyCeilingMinutes({ ...splitter, canSplitShift: false }, entry(360, 1200), rules)).toBe(480)
  })
})

describe("la S46 : deux volontaires sur un férié court", () => {
  // Le 11/11/2026, ouvert de 8 h 30 à 13 h (270 min). Deux volontaires à
  // 270 min chacun devaient tous deux ouvrir ET fermer — ce que la règle d'un
  // ouvreur et d'un fermeur distincts interdit. Chacun compte donc au plus
  // l'amplitude moins un pas.
  const short = (volunteers: readonly string[]): HolidayPlanEntry => ({
    date: HOLIDAY, opening: "travaille", volunteerIds: [...volunteers], opensAtMinutes: 510, closesAtMinutes: 780,
  })

  it("laisse à chacun de quoi ne pas tenir les deux bouts", () => {
    const team36 = [1, 2, 3, 4].map((n) =>
      employee(`e${n}`, { weeklyHours: 33, weeklyMinutes: 1_980, sectors: ["Test"] } as Partial<EmployeeRecord>)
    )
    const problem = problemFor({ employees: team36, sectors: [exact()], holidayPlan: [short(["e1", "e2"])] })
    const day = problem.days.find((entry) => entry.date === HOLIDAY)!
    expect(day.budgetMinutes).toBeLessThanOrEqual(2 * (270 - 15))
    expect(day.budgetMinutes).toBeGreaterThanOrEqual(2 * 240)
  })
})
