import { describe, expect, it } from "vitest"

import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import { buildHourlyProfile, createEmptySector } from "@/features/sectors"
import type { SectorDemandConfiguration } from "@/features/sectors"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

import { diagnoseSectorConfiguration } from "@/features/planning/flow"
import { employee, storeConfig } from "@/features/planning/__tests__/planning-fixtures"

/**
 * NON-REGRESSION — a third sector must never break the other two silently.
 *
 * Every case states what a manager should be told. The rule the whole module
 * follows: an unplannable configuration produces a SENTENCE, never a repaired
 * planning and never a quietly smaller selection.
 */

const OPEN: readonly WeekDay[] = ["monday", "tuesday", "wednesday", "thursday", "friday"]
const STORE = storeConfig()

function completeSector(id: string, name: string): SectorDemandConfiguration {
  const base = createEmptySector(id)
  return {
    ...base,
    name,
    status: "active",
    workEveryNonFixedRestDay: false,
    hours: WEEK_DAYS.map((day) =>
      OPEN.includes(day)
        ? { day, closed: false, opensAt: "09:00", closesAt: "17:00" }
        : { day, closed: true, opensAt: "09:00", closesAt: "17:00" }
    ),
    weeklyDistribution: Object.fromEntries(
      WEEK_DAYS.map((day) => [day, OPEN.includes(day) ? 20 : 0])
    ) as Record<WeekDay, number>,
    coverage: {
      standardDay: "monday",
      profiles: Object.fromEntries(OPEN.map((day) => [day, buildHourlyProfile("09:00", "17:00", 1)])),
    },
    shiftRules: {
      ...base.shiftRules,
      inheritMinimumShiftDuration: false,
      minimumShiftDuration: 240,
      maximumDailyDuration: 480,
      splitShiftAllowed: false,
    },
  }
}

function staff(id: string, sector: string): EmployeeRecord {
  return employee(id, { weeklyHours: 20, weeklyMinutes: 1_200, sectors: [sector] } as Partial<EmployeeRecord>)
}

const DRIVE = completeSector("drive", "Drive")
const ACCUEIL = completeSector("accueil", "Accueil")
const STAFF = [staff("d1", "Drive"), staff("a1", "Accueil")]

function diagnose(
  sectors: readonly SectorDemandConfiguration[],
  employees: readonly EmployeeRecord[] = STAFF
) {
  return diagnoseSectorConfiguration({ store: STORE, sectors, employees })
}

function codes(sectors: readonly SectorDemandConfiguration[], employees?: readonly EmployeeRecord[]) {
  return diagnose(sectors, employees).map((problem) => problem.code)
}

describe("un troisième secteur valide", () => {
  it("n'ajoute aucun problème quand il est seul actif", () => {
    const third = completeSector("third", "Boulangerie")
    expect(codes([third], [staff("b1", "Boulangerie")])).toEqual([])
  })

  it("ne suppose jamais un nombre fixe de secteurs", () => {
    // One, two, five: the diagnosis is a function of the configuration, never of
    // a count someone hard-coded.
    for (const count of [1, 2, 3, 5]) {
      const sectors = Array.from({ length: count }, (_, index) =>
        completeSector(`s${index}`, `Secteur ${index}`)
      )
      const people = sectors.map((sector, index) => staff(`e${index}`, sector.name))
      // A complete sector is a complete sector whatever its neighbours do: the
      // count belongs to `resolveGenerationScope`, never to a diagnosis.
      expect(diagnose(sectors, people)).toEqual([])
    }
  })
})

describe("un troisième secteur incomplet", () => {
  it("nomme les jours sans budget journalier", () => {
    const broken = {
      ...ACCUEIL,
      weeklyDistribution: {
        ...ACCUEIL.weeklyDistribution,
        monday: 0,
        tuesday: 0,
        wednesday: 0,
      } as Record<WeekDay, number>,
    }
    const problems = diagnose([broken])
    const budget = problems.find((problem) => problem.code === "missing_daily_budget")

    expect(budget?.message).toBe(
      "Le secteur « Accueil » ne peut pas être planifié : budget journalier manquant les lundi, mardi et mercredi."
    )
  })

  it("signale l'absence totale d'horaires d'ouverture", () => {
    const closed = {
      ...ACCUEIL,
      hours: WEEK_DAYS.map((day) => ({ day, closed: true, opensAt: "09:00", closesAt: "17:00" })),
    }
    const problems = diagnose([closed])
    expect(problems.map((problem) => problem.code)).toContain("no_open_day")
    // Nothing below a missing calendar is worth saying: "no budget on no days"
    // would be noise, not information.
    expect(problems.map((problem) => problem.code)).not.toContain("missing_daily_budget")
  })

  it("signale l'absence de demande", () => {
    const noDemand = { ...ACCUEIL, coverage: { standardDay: null, profiles: {} } }
    const problems = diagnose([noDemand])
    const demand = problems.find((problem) => problem.code === "missing_demand")
    expect(demand?.message).toContain("aucun besoin en personnel")
    expect(demand?.message).toContain("Accueil")
  })

  it("signale l'absence de salarié éligible", () => {
    const problems = diagnose([ACCUEIL], [staff("d1", "Drive")])
    const staffing = problems.find((problem) => problem.code === "no_eligible_employee")
    expect(staffing?.message).toBe(
      "Aucun salarié n'est affecté au secteur « Accueil » : affectez-lui au moins un salarié actif."
    )
  })

  it("attribue chaque problème au secteur concerné", () => {
    const broken = { ...ACCUEIL, coverage: { standardDay: null, profiles: {} } }
    const problems = diagnose([broken])
    expect(problems.every((problem) => problem.sectorId === null || problem.sectorId === "accueil")).toBe(true)
    expect(problems.some((problem) => problem.sectorName === "Drive")).toBe(false)
  })
})

describe("sélections", () => {
  it("laisse générer un secteur valide seul, même si un autre est cassé ailleurs", () => {
    // The broken sector is not in the selection, so it has no say in it.
    expect(codes([DRIVE], [staff("d1", "Drive")])).toEqual([])
  })

  it("refuse une sélection qui contient le secteur invalide, sans l'exclure", () => {
    const broken = { ...ACCUEIL, coverage: { standardDay: null, profiles: {} } }
    const problems = diagnose([DRIVE, broken])

    // Accueil is named, and Drive is not silently planned without it.
    expect(problems.some((problem) => problem.code === "missing_demand")).toBe(true)
    expect(problems.some((problem) => problem.sectorName === "Accueil")).toBe(true)
  })

  it("ne demande JAMAIS de désactiver un secteur", () => {
    // The wording this whole correction removes: the configuration is shared and
    // long-lived, and no message may ask a manager to change it in order to
    // generate something else.
    const problems = diagnose([DRIVE, ACCUEIL, completeSector("marche", "Zone Marché")], [
      staff("d1", "Drive"),
      staff("a1", "Accueil"),
      staff("m1", "Zone Marché"),
    ])
    for (const problem of problems) {
      expect(problem.message).not.toContain("désactiv")
      expect(problem.message).not.toContain("n'en laissez qu'un")
    }
  })

  it("ignore les secteurs archivés : ils ne comptent pas dans la limite", () => {
    const inactive = { ...ACCUEIL, status: "archived" as const }
    expect(codes([DRIVE, inactive], [staff("d1", "Drive")])).toEqual([])
  })

  it("refuse une configuration où tout est archivé", () => {
    const inactive = { ...DRIVE, status: "archived" as const }
    expect(codes([inactive])).toEqual(["no_active_sector"])
  })

  it("diagnostique TOUS les secteurs actifs, pas seulement le premier fautif", () => {
    // Someone fixing their configuration should see everything at once rather
    // than discover the next problem after each correction.
    const brokenA = { ...completeSector("a", "A"), coverage: { standardDay: null, profiles: {} } }
    const brokenB = { ...completeSector("b", "B"), coverage: { standardDay: null, profiles: {} } }
    const problems = diagnose([brokenA, brokenB], [staff("x", "A"), staff("y", "B")])

    expect(problems.filter((problem) => problem.code === "missing_demand")).toHaveLength(2)
  })

  it("ne renvoie jamais une infaisabilité pour une configuration invalide", () => {
    // A misconfiguration says nothing about whether the week could be staffed.
    const broken = { ...ACCUEIL, coverage: { standardDay: null, profiles: {} } }
    for (const problem of diagnose([DRIVE, broken])) {
      expect(problem.code).not.toContain("infeasible")
    }
  })
})
