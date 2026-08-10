import { describe, expect, it } from "vitest"
import { WEEK_DAYS } from "@/features/core/models"
import { buildHourlyProfile, copyCoverageProfile, createEmptySector, createSectorRepository, effectiveWeeklyDistribution, validateSectorDemand } from "@/features/sectors"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

const store = { openingHours: WEEK_DAYS.map((day) => ({ day, closed: day === "sunday", opensAt: "08:00", closesAt: "20:00" })), minShiftDuration: 120 } as StoreConfig
function complete() { const base = createEmptySector("sector_1"); return { ...base, name: "Accueil", weeklyDistributionEnabled: true, hours: base.hours.map((day) => day.day === "monday" || day.day === "tuesday" ? { ...day, closed: false } : day), coverage: { standardDay: "monday" as const, profiles: { monday: buildHourlyProfile("09:00", "18:00", 2), tuesday: buildHourlyProfile("09:00", "18:00", 2) } }, weeklyDistribution: { monday: 50, tuesday: 50, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 0 }, competencies: [{ id: "skill_1", name: "Conseil", archived: false, order: 0 }] } }

describe("configuration de demande secteur", () => {
  it("valide et persiste une configuration complète avec règles et compétences liées", () => { const sector = complete(); expect(validateSectorDemand(sector, store)).toEqual([]); let value: string | null = null; const repository = createSectorRepository({ getItem: () => value, setItem: (_key, next) => { value = next } }); repository.save([sector]); expect(repository.list()[0].shiftRules.minimumShiftDuration).toBeNull(); expect(repository.list()[0].competencies[0].name).toBe("Conseil") })
  it("copie un profil sans lier les exceptions éditées", () => { const copied = copyCoverageProfile(complete(), "monday", "tuesday"); const changed = { ...copied, coverage: { ...copied.coverage, profiles: { ...copied.coverage.profiles, tuesday: copied.coverage.profiles.tuesday!.map((slot, index) => index === 0 ? { ...slot, employees: 7 } : slot) } } }; expect(changed.coverage.profiles.monday![0].employees).toBe(2); expect(changed.coverage.profiles.tuesday![0].employees).toBe(7) })
  it("exige la couverture complète et exactement 100 %", () => { const sector = complete(); const broken = { ...sector, coverage: { ...sector.coverage, profiles: { ...sector.coverage.profiles, monday: sector.coverage.profiles.monday!.slice(1) } }, weeklyDistribution: { ...sector.weeklyDistribution, monday: 49 } }; const issues = validateSectorDemand(broken, store); expect(issues.some((issue) => issue.path === "coverage.monday")).toBe(true); expect(issues.some((issue) => issue.path === "weeklyDistribution")).toBe(true) })
  it("autorise 0 % sur les jours fermés", () => { expect(validateSectorDemand(complete(), store).some((issue) => issue.path === "weeklyDistribution")).toBe(false) })
  it("ACCEPTE un secteur plus large que le magasin", () => {
    // Le magasin ouvre à 08:00 ; le Drive ouvre à 06:00 et l'Accueil ferme
    // après la surface de vente. La règle inverse était écrite dans le
    // validateur et refusait des configurations parfaitement réelles.
    const sector = complete()
    const wider = {
      ...sector,
      hours: sector.hours.map((day) => (day.day === "monday" ? { ...day, opensAt: "06:00", closesAt: "22:00" } : day)),
      coverage: { ...sector.coverage, profiles: { ...sector.coverage.profiles, monday: buildHourlyProfile("06:00", "22:00", 2) } },
    }
    expect(validateSectorDemand(wider, store).some((issue) => issue.path === "hours.monday")).toBe(false)
  })

  it("rejette toujours un horaire mal formé ou qui finit avant de commencer", () => {
    const sector = complete()
    const offStep = { ...sector, hours: sector.hours.map((day) => (day.day === "monday" ? { ...day, opensAt: "09:07" } : day)) }
    expect(validateSectorDemand(offStep, store).some((issue) => issue.path === "hours.monday")).toBe(true)

    const backwards = { ...sector, hours: sector.hours.map((day) => (day.day === "monday" ? { ...day, opensAt: "18:00", closesAt: "09:00" } : day)) }
    expect(validateSectorDemand(backwards, store).some((issue) => issue.path === "hours.monday")).toBe(true)
  })
  it("valide et persiste la coupure maximale du secteur", () => { const valid = { ...complete(), shiftRules: { ...complete().shiftRules, splitShiftAllowed: true, maximumSplitDuration: 90 } }; expect(validateSectorDemand(valid, store)).toEqual([]); let value: string | null = null; const repository = createSectorRepository({ getItem: () => value, setItem: (_key, next) => { value = next } }); repository.save([valid]); expect(repository.list()[0].shiftRules.maximumSplitDuration).toBe(90); const invalid = { ...valid, shiftRules: { ...valid.shiftRules, maximumSplitDuration: 100 } }; expect(validateSectorDemand(invalid, store).some((issue) => issue.path === "shiftRules.maximumSplitDuration")).toBe(true) })
  it("migre explicitement les secteurs historiques Drive vers les jours obligatoires", () => {
    const historical = { ...complete() } as Record<string, unknown>
    delete historical.workEveryNonFixedRestDay
    let value: string | null = JSON.stringify([historical])
    const repository = createSectorRepository({ getItem: () => value, setItem: (_key, next) => { value = next } })
    expect(repository.list()[0].workEveryNonFixedRestDay).toBe(true)
  })
  it("conserve explicitement false lors de la migration", () => {
    let value: string | null = JSON.stringify([{ ...complete(), workEveryNonFixedRestDay: false }])
    const repository = createSectorRepository({ getItem: () => value, setItem: (_key, next) => { value = next } })
    expect(repository.list()[0].workEveryNonFixedRestDay).toBe(false)
  })
  it("rend les deux répartitions en pourcentage facultatives sur un nouveau secteur", () => {
    const sector = createEmptySector("new")
    expect(sector.marketZone).toBe(false)
    expect(sector.hourlyPercentagesEnabled).toBe(false)
    expect(sector.weeklyDistributionEnabled).toBe(false)
    expect(sector.workEveryNonFixedRestDay).toBe(true)
  })
  it("persiste l'appartenance explicite à Zone marché et ne l'invente pas à la migration", () => {
    let value: string | null = JSON.stringify([{ ...complete(), marketZone: true }])
    const repository = createSectorRepository({ getItem: () => value, setItem: (_key, next) => { value = next } })
    expect(repository.list()[0].marketZone).toBe(true)
    value = JSON.stringify([{ ...complete(), marketZone: undefined }])
    expect(repository.list()[0].marketZone).toBe(false)
  })
  it("désactive une seule fois les anciennes colonnes de parts horaires", () => {
    const legacy = { ...complete(), hourlyPercentagesEnabled: true } as Record<string, unknown>
    delete legacy.percentageOptionsVersion
    let value: string | null = JSON.stringify([legacy])
    const repository = createSectorRepository({ getItem: () => value, setItem: (_key, next) => { value = next } })
    const migrated = repository.list()[0]
    expect(migrated.hourlyPercentagesEnabled).toBe(false)
    expect(migrated.percentageOptionsVersion).toBe(1)
  })
  it("déduit la répartition hebdomadaire du volume de couverture lorsqu'elle est automatique", () => {
    const sector = { ...complete(), weeklyDistributionEnabled: false, coverage: { standardDay: "monday" as const, profiles: { monday: buildHourlyProfile("09:00", "18:00", 1), tuesday: buildHourlyProfile("09:00", "18:00", 3) } } }
    const distribution = effectiveWeeklyDistribution(sector)
    expect(distribution.monday).toBe(25)
    expect(distribution.tuesday).toBe(75)
    expect(WEEK_DAYS.reduce((sum, day) => sum + distribution[day], 0)).toBe(100)
    expect(validateSectorDemand({ ...sector, weeklyDistribution: { ...sector.weeklyDistribution, monday: 0, tuesday: 0 } }, store).some((issue) => issue.path === "weeklyDistribution")).toBe(false)
  })
})
