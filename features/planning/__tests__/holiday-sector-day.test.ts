import { describe, expect, it } from "vitest"

import type { HolidayPlanEntry, HolidaySectorDay, IsoDate } from "@/features/core/models"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { createHolidayRepository } from "@/features/planning/holidays/holiday.repository"
import { holidayPlanForPeriod } from "@/features/planning/holidays/model/holiday-plan"
import {
  defaultHolidaySectorDay,
  resolveHolidaySectorDay,
  withHolidayHours,
} from "@/features/planning/holidays/model/holiday-sector-day"
import {
  employee,
  SMALL_SECTOR_SCOPE,
  smallSector,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"

/**
 * Le jour férié d'un rayon : ses horaires, son besoin, ou sa fermeture.
 *
 * Avant : le 11/11/2026, le Drive commençait à 8 h 30 — l'heure d'ouverture du
 * MAGASIN ce jour-là —, alors que le rayon ouvre à 6 h. Un férié ne savait
 * régler que le magasin entier.
 */

const HOLIDAY = "2026-07-07" as IsoDate

function worked(volunteerIds: readonly string[], sectorDays?: Record<string, HolidaySectorDay>): HolidayPlanEntry {
  return {
    date: HOLIDAY,
    opening: "travaille",
    volunteerIds: [...volunteerIds],
    opensAtMinutes: 510,
    closesAtMinutes: 780,
    ...(sectorDays ? { sectorDays } : {}),
  }
}

const team = () =>
  [1, 2, 3].map((n) => employee(`e${n}`, { weeklyHours: 24, weeklyMinutes: 1_440, sectors: ["Test"] } as Partial<EmployeeRecord>))

function problemFor(sector: ReturnType<typeof smallSector>, holidayPlan: readonly HolidayPlanEntry[]) {
  const prepared = preparePlanningGeneration({
    savedPlannings: [],
    absences: [],
    store: storeConfig({
      openingHours: storeConfig().openingHours.map((day) =>
        day.closed ? day : { ...day, opensAt: "06:00", closesAt: "17:00" }
      ),
    }),
    employees: team(),
    sectors: [sector],
    scope: SMALL_SECTOR_SCOPE,
    holidayPlan,
  })
  if (prepared.status === "error") throw new Error(prepared.errors.map((e) => e.message).join(" | "))
  const built = buildPlanningProblemV3(prepared.generationInput)
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join(" | "))
  return built.problem
}

const drive = (holidayDay?: HolidaySectorDay) => ({
  ...smallSector(),
  hours: smallSector().hours.map((day) => (day.closed ? day : { ...day, opensAt: "06:00", closesAt: "17:00" })),
  ...(holidayDay ? { holidayDay } : {}),
})
const holidayOf = (problem: ReturnType<typeof problemFor>) => problem.days.find((day) => day.date === HOLIDAY)!

describe("le jour férié type d'un rayon", () => {
  const template = { ...defaultHolidaySectorDay("06:00", "13:00", 2) }

  it("ouvre le rayon à SES horaires, pas à ceux du magasin", () => {
    const day = holidayOf(problemFor(drive(template), [worked(["e1", "e2"])]))
    expect(day).toMatchObject({ closed: false, opensAtMinutes: 360, closesAtMinutes: 780 })
  })

  it("pose le besoin du modèle ce jour-là", () => {
    const slots = problemFor(drive(template), [worked(["e1", "e2"])]).demandSlots.filter((slot) => slot.date === HOLIDAY)
    expect(slots.map((slot) => slot.startMinutes)).toEqual([360, 420, 480, 540, 600, 660, 720])
    expect(slots.every((slot) => slot.requiredEmployees === 2)).toBe(true)
  })

  it("garde les horaires du magasin sans modèle — comme avant", () => {
    const day = holidayOf(problemFor(drive(), [worked(["e1", "e2"])]))
    expect(day).toMatchObject({ opensAtMinutes: 510, closesAtMinutes: 780 })
  })

  it("ferme le rayon quand le modèle le dit, et reporte sa part", () => {
    const problem = problemFor(drive({ ...template, closed: true }), [worked(["e1", "e2"])])
    expect(holidayOf(problem)).toMatchObject({ closed: true, budgetMinutes: 0 })
    expect(problem.demandSlots.filter((slot) => slot.date === HOLIDAY)).toEqual([])
    const total = problem.days.reduce((sum, day) => sum + day.budgetMinutes, 0)
    expect(total).toBe(problem.employees.reduce((sum, entry) => sum + entry.contractMinutes, 0))
  })
})

describe("l'ajustement d'un férié précis", () => {
  it("l'emporte sur le modèle du rayon", () => {
    const adjusted = defaultHolidaySectorDay("07:00", "12:00", 1)
    const day = holidayOf(problemFor(
      drive(defaultHolidaySectorDay("06:00", "13:00", 2)),
      [worked(["e1", "e2"], { [smallSector().id]: adjusted })]
    ))
    expect(day).toMatchObject({ opensAtMinutes: 420, closesAtMinutes: 720 })
  })

  it("ne vaut rien un férié chômé : le magasin entier est fermé", () => {
    const entry: HolidayPlanEntry = { ...worked([]), opening: "chome", opensAtMinutes: null, closesAtMinutes: null }
    expect(resolveHolidaySectorDay(entry, drive(defaultHolidaySectorDay("06:00", "13:00")))).toBeNull()
  })

  it("se relit depuis le stockage, et rejoint le plan de la période", async () => {
    const memory = new Map<string, string>()
    const repository = createHolidayRepository({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
    })
    const adjusted = defaultHolidaySectorDay("06:00", "13:00", 2)
    await repository.save({ [HOLIDAY]: { opening: "travaille", opensAt: "08:30", closesAt: "13:00", volunteerIds: ["e1"], sectors: { drive: adjusted } } })
    const stored = await repository.read()
    expect(stored[HOLIDAY]?.sectors?.drive).toEqual(adjusted)
  })
})

describe("withHolidayHours", () => {
  it("garde le nombre de personnes des plages qui subsistent", () => {
    const day = defaultHolidaySectorDay("06:00", "09:00", 1)
    const edited = { ...day, slots: day.slots.map((slot) => (slot.start === "07:00" ? { ...slot, employees: 3 } : slot)) }
    const longer = withHolidayHours(edited, "06:00", "10:00")
    expect(longer.slots.map((slot) => [slot.start, slot.employees])).toEqual([["06:00", 1], ["07:00", 3], ["08:00", 1], ["09:00", 1]])
  })
})

// `holidayPlanForPeriod` est la porte entre le stockage et le moteur : il doit
// faire passer l'ajustement, et rien d'autre quand il n'y en a pas.
describe("holidayPlanForPeriod", () => {
  it("transmet l'ajustement d'un rayon, et seulement s'il existe", () => {
    const usual = () => ({ opensAt: "08:30", closesAt: "13:00" })
    const period = { start: "2026-11-09" as IsoDate, end: "2026-11-15" as IsoDate }
    const adjusted = defaultHolidaySectorDay("06:00", "13:00")
    const withSector = holidayPlanForPeriod(period, { ["2026-11-11" as IsoDate]: { opening: "travaille", sectors: { drive: adjusted } } }, usual)
    const without = holidayPlanForPeriod(period, { ["2026-11-11" as IsoDate]: { opening: "travaille" } }, usual)
    expect(withSector[0]?.sectorDays?.drive).toEqual(adjusted)
    expect(without[0] && "sectorDays" in without[0]).toBe(false)
  })
})
