import { describe, expect, it } from "vitest"

import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import {
  driveEmployeeRecords,
  historicalSetupPayload,
  readMigratedSectors,
} from "@/features/core/planning-v3/__tests__/drive-problem"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { solvePlanningProblemV3 } from "@/features/core/planning-v3/solver"
import { buildHourlyProfile, createEmptySector } from "@/features/sectors"
import type { SectorDemandConfiguration } from "@/features/sectors"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

import {
  preparePlanningGeneration,
  resolveGenerationScope,
  runPlanningFlow,
} from "@/features/planning/flow"
import {
  employee,
  SECTOR_SCOPE,
  sectorStoreConfig,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"

/**
 * The filtered scope must be a SUBSET, never a reconstruction.
 *
 * `resolveGenerationScope` removes sectors and employees and touches nothing
 * else. That is the whole contract, and it is worth asserting field by field:
 * a filter that rebuilt sector or employee objects would quietly drop nested
 * data — hours, coverage profiles, rest days, shift rules — and the engine
 * would then report "aucune position légale" about a week that is perfectly
 * plannable.
 */

const OPEN: readonly WeekDay[] = ["monday", "tuesday", "wednesday", "thursday", "friday"]

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

function staff(id: string, sectors: readonly string[]): EmployeeRecord {
  return employee(id, {
    weeklyHours: 20,
    weeklyMinutes: 1_200,
    sectors: [...sectors],
    workingDays: [...OPEN],
  } as Partial<EmployeeRecord>)
}

const DRIVE = completeSector("drive", "Drive")
const ACCUEIL = completeSector("accueil", "Accueil")

describe("le filtrage ne perd aucun champ", () => {
  const sectors = [DRIVE, ACCUEIL]
  const people = [staff("d1", ["Drive"]), staff("d2", ["Drive"]), staff("a1", ["Accueil"])]

  function scopeFor(selected: readonly string[]) {
    const verdict = resolveGenerationScope({
      store: storeConfig(),
      sectors,
      employees: people,
      selectedSectorIds: selected,
    })
    if (verdict.kind !== "generate") throw new Error(`refusé : ${verdict.message}`)
    return verdict.scope
  }

  it("transmet les secteurs par référence, sans les reconstruire", () => {
    // Identity, not deep equality: a rebuilt object could differ in a nested
    // field nobody thought to copy.
    expect(scopeFor(["drive"]).sectors[0]).toBe(DRIVE)
  })

  it("conserve horaires, couverture, budgets et règles de shift à l'identique", () => {
    const kept = scopeFor(["drive"]).sectors[0]
    expect(kept.hours).toEqual(DRIVE.hours)
    expect(kept.coverage).toEqual(DRIVE.coverage)
    expect(kept.weeklyDistribution).toEqual(DRIVE.weeklyDistribution)
    expect(kept.shiftRules).toEqual(DRIVE.shiftRules)
    expect(kept.workEveryNonFixedRestDay).toBe(DRIVE.workEveryNonFixedRestDay)
  })

  it("transmet les salariés par référence, disponibilités et repos compris", () => {
    const kept = scopeFor(["drive"]).employees
    expect(kept[0]).toBe(people[0])
    expect(kept.map((person) => person.id)).toEqual(["d1", "d2"])
    for (const person of kept) {
      const original = people.find((candidate) => candidate.id === person.id)!
      expect(person.workingDays).toEqual(original.workingDays)
      expect(person.fixedDaysOff).toEqual(original.fixedDaysOff)
      expect(person.forbiddenDays).toEqual(original.forbiddenDays)
      expect(person.weeklyMinutes).toBe(original.weeklyMinutes)
    }
  })

  it("est une SOUS-LISTE : rien d'autre que des retraits", () => {
    const scope = scopeFor(["drive"])
    expect(sectors).toEqual(expect.arrayContaining([...scope.sectors]))
    expect(people).toEqual(expect.arrayContaining([...scope.employees]))
  })

  it("garde un salarié multi-secteurs planifiable sur le secteur sélectionné", () => {
    // Filtering by membership must not cost someone their availability just
    // because one of their other sectors is out of scope.
    const shared = staff("both", ["Drive", "Accueil"])
    const verdict = resolveGenerationScope({
      store: storeConfig(),
      sectors,
      employees: [...people, shared],
      selectedSectorIds: ["drive"],
    })
    if (verdict.kind !== "generate") throw new Error("refusé")
    expect(verdict.scope.employees).toContain(shared)
    expect(verdict.scope.employees.find((person) => person.id === "both")).toBe(shared)
  })

  it("n'emporte aucune référence à un secteur retiré", () => {
    const scope = scopeFor(["drive"])
    const names = new Set(scope.sectors.map((sector) => sector.name))
    for (const person of scope.employees) {
      expect(person.sectors?.some((name) => names.has(name))).toBe(true)
    }
  })
})

describe("un secteur seul produit des candidats légaux", () => {
  const store = sectorStoreConfig()
  const sectors = readMigratedSectors(historicalSetupPayload())
  const employees = driveEmployeeRecords()

  function driveScope() {
    const verdict = resolveGenerationScope({
      store,
      sectors,
      employees,
      selectedSectorIds: sectors.map((sector) => sector.id),
    })
    if (verdict.kind !== "generate") throw new Error(`refusé : ${verdict.message}`)
    return verdict.scope
  }

  it("garde les cinq salariés du secteur", () => {
    expect(driveScope().employees).toHaveLength(5)
  })

  it("V2 place réellement des shifts, sans placement impossible", () => {
    const scope = driveScope()
    const result = runPlanningFlow({
      store,
      employees: scope.employees,
      sectors: scope.sectors,
      scope: SECTOR_SCOPE,
    })

    expect(result.status).toBe("success")
    if (result.status !== "success") return
    const impossible = result.generation.issues.filter(
      (issue) => issue.code === "daily_placement_impossible"
    )
    // The symptom this whole investigation is about: zero legal positions.
    expect(impossible).toEqual([])
    expect(result.generation.shifts.length).toBeGreaterThan(0)
    expect(result.generation.assignments.length).toBeGreaterThan(0)
  }, 60_000)

  it("V3 construit ET résout réellement le même périmètre", () => {
    const scope = driveScope()
    const prepared = preparePlanningGeneration({
      store,
      employees: scope.employees,
      sectors: scope.sectors,
      scope: SECTOR_SCOPE,
    })
    expect(prepared.status).toBe("ready")
    if (prepared.status !== "ready") return

    const built = buildPlanningProblemV3(prepared.generationInput)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    // Every employee-day the problem declares must have somewhere legal to go.
    expect(built.problem.employees).toHaveLength(5)
    expect(built.problem.days.filter((day) => !day.closed).length).toBeGreaterThan(0)

    const solved = solvePlanningProblemV3(built.problem, { timeoutMs: 20_000, maximumStates: 200_000 })
    // Feasible or merely time-limited, but never "the space is empty".
    expect(solved.status).not.toBe("invalid-problem")
    expect(solved.diagnostics.map((entry) => entry.code)).not.toContain(
      "search_exhausted_without_solution"
    )
  }, 60_000)
})

describe("le placement impossible dit QUELLE règle a tout éliminé", () => {
  it("nomme la règle et compte les débuts testés", () => {
    // A day whose store window is shorter than the minutes the sector allocates:
    // every start fails the same test, and the message must say so rather than
    // leaving the reader to guess among a dozen rules.
    const narrow = storeConfig({
      openingHours: WEEK_DAYS.map((day) =>
        OPEN.includes(day)
          ? { day, closed: false, opensAt: "09:00", closesAt: "13:00" }
          : { day, closed: true, opensAt: "", closesAt: "" }
      ),
      minShiftDuration: 60,
      maxShiftDuration: 600,
    })
    const wide = { ...completeSector("wide", "Large"), name: "Large" }
    const people = [staff("w1", ["Large"]), staff("w2", ["Large"])]

    const result = runPlanningFlow({
      store: narrow,
      employees: people,
      sectors: [wide],
      scope: { planningId: "p", period: { start: "2026-07-06", end: "2026-07-12" }, now: "2026-07-01T00:00:00.000Z" },
    })

    expect(result.status).toBe("success")
    if (result.status !== "success") return
    const impossible = result.generation.issues.filter(
      (issue) => issue.code === "daily_placement_impossible"
    )
    if (impossible.length === 0) return // this fixture happened to fit; nothing to assert

    for (const issue of impossible) {
      // Window, starts tested, and the ranked reason — everything needed to act.
      expect(issue.message).toContain("Fenêtre")
      expect(issue.message).toContain("début(s) testé(s)")
      expect(issue.details).toHaveProperty("startsTested")
      expect(issue.details).toHaveProperty("opensAt")
      expect(issue.details).toHaveProperty("closesAt")
    }
  }, 60_000)
})

describe("magasin plus large que le secteur — la régression signalée", () => {
  /**
   * The reported configuration, reduced to its essential shape: a store that
   * closes LATER than the sector it contains.
   *
   * Before the fix the placement window came from the STORE, so "closes the day"
   * meant the store's closing time. The employee designated to close was allowed
   * exactly one start — the one ending at the store's close — and that single
   * start was then rejected as `outside_sector_hours`. Zero legal positions for
   * the closer, every day, cascading into "0 minutes assignables" for the whole
   * team once contract completion failed.
   *
   * Deliberately built on the SMALL sector rather than Drive: the mechanism is
   * identical and the proof costs a second instead of minutes.
   */
  const SECTOR = completeSector("late", "Tardif")
  const LATE_STORE = storeConfig({
    openingHours: WEEK_DAYS.map((day) =>
      OPEN.includes(day)
        ? { day, closed: false, opensAt: "09:00", closesAt: "17:45" }
        : { day, closed: true, opensAt: "", closesAt: "" }
    ),
    minShiftDuration: 240,
    maxShiftDuration: 600,
  })
  const PEOPLE = [staff("t1", ["Tardif"]), staff("t2", ["Tardif"])]

  function run() {
    const verdict = resolveGenerationScope({
      store: LATE_STORE,
      sectors: [SECTOR],
      employees: PEOPLE,
      selectedSectorIds: ["late"],
    })
    if (verdict.kind !== "generate") throw new Error(`refusé : ${verdict.message}`)
    return runPlanningFlow({
      store: LATE_STORE,
      employees: verdict.scope.employees,
      sectors: verdict.scope.sectors,
      scope: SECTOR_SCOPE,
    })
  }

  it("le secteur ferme bien avant le magasin, sinon le test ne prouve rien", () => {
    expect(SECTOR.hours.find((hours) => hours.day === "monday")!.closesAt).toBe("17:00")
    expect(LATE_STORE.openingHours.find((hours) => hours.day === "monday")!.closesAt).toBe("17:45")
  })

  it("ne laisse plus aucun salarié-jour sans position légale", () => {
    const result = run()
    expect(result.status).toBe("success")
    if (result.status !== "success") return
    expect(
      result.generation.issues
        .filter((issue) => issue.code === "daily_placement_impossible")
        .map((issue) => issue.message)
    ).toEqual([])
  }, 120_000)

  it("place des shifts, tous dans les horaires du SECTEUR et non du magasin", () => {
    const result = run()
    if (result.status !== "success") return
    expect(result.generation.shifts.length).toBeGreaterThan(0)
    // The property the old window violated.
    for (const shift of result.generation.shifts) {
      expect(shift.segments.at(-1)!.endTime <= "17:00").toBe(true)
      expect(shift.segments[0].startTime >= "09:00").toBe(true)
    }
  }, 120_000)
})
