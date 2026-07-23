import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import { buildHourlyProfile, createEmptySector } from "@/features/sectors"
import type { SectorDemandConfiguration } from "@/features/sectors"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * The smallest complete store an end-to-end planning run accepts.
 *
 * Extracted from `planning-flow.test.ts`, which still uses it, so the V2 flow
 * and the V3 mode are exercised against the SAME store. Two fixtures would have
 * let the engines be compared on weeks that were never actually the same.
 */

export const FIXTURE_NOW = "2026-07-01T00:00:00.000Z"
const WEEKEND = new Set(["saturday", "sunday"])

/** A valid onboarding store config: weekdays 09:00–17:00, weekend closed. */
export function storeConfig(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return {
    name: "Test Store",
    address: "1 rue de Test",
    city: "Paris",
    postalCode: "75001",
    country: "France",
    timezone: "Europe/Paris",
    openingHours: WEEK_DAYS.map((day) =>
      WEEKEND.has(day)
        ? { day, closed: true, opensAt: "", closesAt: "" }
        : { day, closed: false, opensAt: "09:00", closesAt: "17:00" }
    ),
    planningMode: "dynamic",
    minShiftDuration: 120,
    maxShiftDuration: 600,
    timeGranularity: 60,
    splitShiftPolicy: "forbidden",
    minSplitDuration: undefined,
    maxSplitDuration: undefined,
    maxSplitShiftsPerWeek: undefined,
    minDailyHours: 2,
    maxDailyHours: 10,
    minRestBetweenShifts: 11,
    maxWeeklyHoursOverride: undefined,
    ...overrides,
  } as StoreConfig
}

export function employee(id: string, overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    id,
    firstName: id,
    lastName: "Test",
    phone: "",
    email: `${id}@example.test`,
    status: "active",
    weeklyHours: 35,
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    contractType: "full_time",
    canOpen: true,
    canClose: true,
    splitShiftAllowed: false,
    fixedDaysOff: [],
    forbiddenDays: [],
    maxOpenings: null,
    maxClosings: null,
    preferOpening: false,
    preferClosing: false,
    notes: "",
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
    ...overrides,
  }
}

/** Mon 2026-07-06 … Sun 2026-07-12 → 5 open weekdays. */
export const FIXTURE_SCOPE = {
  planningId: "planning_1",
  period: { start: "2026-07-06", end: "2026-07-12" },
  now: FIXTURE_NOW,
}

/**
 * A store whose hours match the Drive sector fixture.
 *
 * V3 needs a sector — a problem with none has no demand, no budget and no
 * opening window, and the builder refuses it. So the V3 path is exercised
 * against the one complete sector this repository already has, and the store
 * around it has to open when that sector does.
 */
export function sectorStoreConfig(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return storeConfig({
    openingHours: WEEK_DAYS.map((day) =>
      day === "sunday"
        ? { day, closed: true, opensAt: "", closesAt: "" }
        : { day, closed: false, opensAt: "06:00", closesAt: "20:00" }
    ),
    minShiftDuration: 240,
    maxShiftDuration: 600,
    minDailyHours: 4,
    maxDailyHours: 10,
    ...overrides,
  })
}

/** The Drive week the CP-SAT spike is pinned on. */
export const SECTOR_SCOPE = {
  planningId: "planning_v3",
  period: { start: "2026-07-20", end: "2026-07-26" },
  now: FIXTURE_NOW,
}

/**
 * A sector small enough that a legal week can be solved in milliseconds.
 *
 * The Drive fixture is the right shape to test a REFUSAL against — it is real,
 * and every rejection path reaches its verdict before any search. It is the
 * wrong shape to test an ACCEPTANCE against: the acceptance gate re-validates
 * the schedule, so the test needs a genuinely legal week, and hand-writing one
 * for Drive is how a fixture becomes a second implementation of the solver.
 *
 * Two people, five short days, one person needed per hour: small enough for the
 * in-process V3 search to answer instantly, real enough to go through the same
 * builder, the same validator and the same acceptance rules.
 */
export function smallSector(): SectorDemandConfiguration {
  const base = createEmptySector("test")
  const open = WEEK_DAYS.filter((day) => !WEEKEND.has(day))
  return {
    ...base,
    name: "Test",
    status: "active",
    hours: WEEK_DAYS.map((day) =>
      WEEKEND.has(day)
        ? { day, closed: true, opensAt: "09:00", closesAt: "17:00" }
        : { day, closed: false, opensAt: "09:00", closesAt: "17:00" }
    ),
    weeklyDistribution: Object.fromEntries(
      WEEK_DAYS.map((day) => [day, WEEKEND.has(day) ? 0 : 20])
    ) as Record<WeekDay, number>,
    coverage: {
      standardDay: "monday",
      profiles: Object.fromEntries(
        open.map((day) => [day, buildHourlyProfile("09:00", "17:00", 1)])
      ),
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

/** The week the small sector is solved over: Mon 2026-07-06 → Sun 2026-07-12. */
export const SMALL_SECTOR_SCOPE = FIXTURE_SCOPE

/** Two people at 20 h, which is exactly the small sector's weekly budget. */
export function smallSectorEmployees(): readonly EmployeeRecord[] {
  return ["e1", "e2"].map((id) =>
    employee(id, {
      weeklyHours: 20,
      weeklyMinutes: 1_200,
      sectors: ["Test"],
      workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    } as Partial<EmployeeRecord>)
  )
}
