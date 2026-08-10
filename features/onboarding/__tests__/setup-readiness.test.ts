import { describe, expect, it } from "vitest"
import { evaluateSetupReadiness } from "@/features/onboarding/setup-readiness"
import { buildHourlyProfile, createEmptySector } from "@/features/sectors"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { WEEK_DAYS } from "@/features/core/models"

const store: StoreConfig = { name: "Magasin test", address: "1 rue du Test", city: "Paris", postalCode: "75001", country: "France", timezone: "Europe/Paris", openingHours: WEEK_DAYS.map((day) => ({ day, closed: day !== "monday", opensAt: "09:00", closesAt: "18:00" })), planningMode: "dynamic", minShiftDuration: 120, maxShiftDuration: 600, timeGranularity: 60, splitShiftPolicy: "forbidden", minSplitDuration: undefined, maxSplitDuration: undefined, maxSplitShiftsPerWeek: undefined, minDailyHours: 2, maxDailyHours: 10, minRestBetweenShifts: 11, maxWeeklyHoursOverride: undefined }
const employee: EmployeeRecord = { id: "employee_1", firstName: "Marie", lastName: "Martin", phone: "", email: "", status: "active", weeklyHours: 35, workingDays: ["monday"], contractType: "full_time", sectors: ["Accueil"], canOpen: true, canClose: true, splitShiftAllowed: false, fixedDaysOff: [], forbiddenDays: [], maxOpenings: null, maxClosings: 0, preferOpening: false, preferClosing: true, notes: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }
const completeSector = () => ({ ...createEmptySector("sector_1"), name: "Accueil", weeklyDistributionEnabled: true, hours: createEmptySector().hours.map((day) => day.day === "monday" ? { ...day, closed: false } : day), coverage: { standardDay: "monday" as const, profiles: { monday: buildHourlyProfile("09:00", "18:00") } }, weeklyDistribution: { monday: 100, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0 } })

describe("configuration initiale", () => {
  it("bloque quand la configuration obligatoire manque", () => { const result = evaluateSetupReadiness({ store, employees: [], sectors: [] }); expect(result.ready).toBe(false); expect(result.blockers).toContain("Créez au moins un secteur.") })
  it("autorise un secteur complet avec un salarié affecté sans compétence obligatoire", () => { expect(evaluateSetupReadiness({ store, employees: [employee], sectors: [completeSector()] })).toEqual({ ready: true, blockers: [] }) })
  it("détecte une demande secteur incomplète", () => { const sector = { ...completeSector(), weeklyDistribution: { ...completeSector().weeklyDistribution, monday: 90 } }; const result = evaluateSetupReadiness({ store, employees: [employee], sectors: [sector] }); expect(result.ready).toBe(false); expect(result.blockers[0]).toContain("Accueil") })
})
