import { describe, expect, it } from "vitest"
import { allocateWeeklyMinutes } from "@/features/core/planning-generator"
import { driveScenario } from "@/features/core/planning-generator/__tests__/drive-alpha-fixture"

describe("WeeklyMinuteAllocator", () => {
  it("verrouille simultanément les lignes contractuelles et les colonnes Drive", () => {
    const input = driveScenario(), sector = input.business!.sectors![0]
    const allocation = allocateWeeklyMinutes({ employees: input.employees, contracts: input.contracts!, dates: ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"], store: input.store, sector, settings: input.settings, requirements: input.demand.requirements })
    expect(allocation.errors).toEqual([])
    expect(allocation.exactDailyBudgets).toBe(true)
    expect(allocation.rows.map((row) => Object.values(row.minutesByDate).reduce((sum, minutes) => sum + minutes, 0))).toEqual([2_205, 2_205, 2_205, 2_205, 2_205])
    expect(allocation.dailyTotals.map((day) => day.allocatedMinutes)).toEqual([1_650, 1_650, 1_650, 1_650, 2_430, 1_995])
    const arthur = allocation.rows.find((row) => String(row.employeeId) === "arthur")!
    expect(arthur.minutesByDate["2026-07-23"]).toBe(0)
    expect(allocation.rows.every((row) => row.minutesByDate["2026-07-24"] > row.minutesByDate["2026-07-21"])).toBe(true)
  }, 10_000)

  it("bloque avant génération une fenêtre de disponibilité plus courte que le shift minimum", () => {
    const input = driveScenario(), sector = input.business!.sectors![0]
    const availability = new Map([["luca|2026-07-20", { maximumContinuousMinutes: 180, reason: "fenêtre disponible de 3 heures" }]])
    const allocation = allocateWeeklyMinutes({ employees: input.employees, contracts: input.contracts!, dates: ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"], store: input.store, sector, settings: input.settings, availabilityByEmployeeDate: availability })
    expect(allocation.rows).toEqual([])
    expect(allocation.errors).toContain("luca ne peut pas placer le shift minimum de 240 minutes le 2026-07-20 (fenêtre disponible de 3 heures).")
  })

  it("bloque quand les jours obligatoires dépassent le contrat", () => {
    const input = driveScenario(), sector = input.business!.sectors![0], contracts = input.contracts!.map((contract) => String(contract.employeeId) === "luca" ? { ...contract, weeklyMinutes: 1_200, weeklyHours: 20 } : contract)
    const allocation = allocateWeeklyMinutes({ employees: input.employees, contracts, dates: ["2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"], store: input.store, sector, settings: input.settings })
    expect(allocation.rows).toEqual([])
    expect(allocation.errors.some((message) => message.includes("6 jours obligatoires × 240 minutes dépassent son contrat de 1200 minutes"))).toBe(true)
  })
})
