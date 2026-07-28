import type {
  ConstraintId,
  Contract,
  ContractId,
  Employee,
  EmployeeId,
  PlanningId,
  StoreId,
} from "@/features/core/models"
import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { ConstraintRegistry } from "@/features/core/constraint-engine"
import type { PlanningGenerationInput } from "@/features/core/planning-generator/types/generation-input"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { createEmptySector, createSectorRepository } from "@/features/sectors"
import type { SectorDemandConfiguration } from "@/features/sectors"

import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import {
  fingerprintProblem,
  structuralSurplusOf,
  validatePlanningSolutionV3,
} from "@/features/core/planning-v3/validator"

/**
 * The LEGACY Drive fixture — a MIGRATION guard, not a statement of the rules.
 *
 * ⚠️ NOT A PERFORMANCE REFERENCE. Use `drive-canonical.ts` for anything that
 * compares engines, quotes a coverage figure, or claims a benchmark. This
 * fixture's employee data does not match the decided Drive rules: it caps one
 * employee at a single opening and two others at a single closing, and it
 * contracts everyone on every open day. None of those is a business rule — they
 * are fixture values that predate the rules being written down, and a parity
 * experiment showed they make the reference schedule illegal. See the note at
 * the top of `drive-canonical.ts`.
 *
 * What this fixture IS good for, and why it stays: it deliberately does NOT
 * start from an already-normalised Core fixture. It starts from the application
 * data a real install holds — a `shiftos_first_run_setup` payload whose Drive
 * sector predates the Sprint 3D `workEveryNonFixedRestDay` flag — and drives it
 * through the repository migration and then the V3 problem builder.
 *
 * That path is the point. A Drive fixture that set the historical flag itself
 * could never reproduce the failure it is supposed to guard against: a legacy
 * sector reaching the engine without the flag and silently reactivating the old
 * behaviour.
 */

/**
 * The Drive scenario as application data, shared by the end-to-end builder test
 * and the solver test so both start from exactly the same historical payload.
 */
export const DATES = [
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
  "2026-07-25",
] as const
export const PERIOD = { start: DATES[0], end: "2026-07-26" }

/** Hourly head-count per open day, 06:00 → 20:00. */
const PROFILES = [
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 1, 3, 1, 4, 1, 1, 1, 1, 1, 3, 2, 1, 1],
  [4, 1, 1, 1, 1, 4, 1, 1, 1, 1, 1, 1, 1, 1],
] as const

const OPEN_DAYS = WEEK_DAYS.filter((day) => day !== "sunday")
const STAMPS = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }

function brand<T>(value: string): T {
  return value as unknown as T
}

/** The five real employees, as the application persists them. */
export function driveEmployeeRecords(): EmployeeRecord[] {
  const people: { id: string; workingDays: readonly WeekDay[]; maxOpenings: number | null; maxClosings: number | null }[] = [
    { id: "luca", workingDays: OPEN_DAYS, maxOpenings: null, maxClosings: 1 },
    { id: "valentin", workingDays: OPEN_DAYS, maxOpenings: 1, maxClosings: 1 },
    { id: "erwan", workingDays: OPEN_DAYS, maxOpenings: null, maxClosings: 1 },
    { id: "arthur", workingDays: ["monday", "tuesday", "wednesday", "friday", "saturday"], maxOpenings: null, maxClosings: 1 },
    { id: "dylan", workingDays: OPEN_DAYS, maxOpenings: null, maxClosings: 2 },
  ]
  return people.map((person) => ({
    ...STAMPS,
    schemaVersion: 2,
    id: person.id,
    firstName: person.id,
    lastName: "Drive",
    phone: "",
    email: `${person.id}@drive.test`,
    status: "active",
    weeklyHours: 36.75,
    weeklyMinutes: 2_205,
    workingDays: [...person.workingDays],
    contractType: "full_time",
    sectors: ["Drive"],
    competencies: {},
    // Dylan is the only one who cannot open. Nothing anywhere keys off his
    // name — the capability alone carries the rule.
    canOpen: person.id !== "dylan",
    canClose: true,
    splitShiftAllowed: person.id === "arthur",
    fixedDaysOff: WEEK_DAYS.filter((day) => !person.workingDays.includes(day)),
    forbiddenDays: [],
    maxOpenings: person.maxOpenings,
    maxClosings: person.maxClosings,
    preferOpening: false,
    preferClosing: false,
    notes: "",
  }))
}

/**
 * A `shiftos_first_run_setup` payload as an install predating Sprint 3D holds
 * it: a complete Drive sector, WITHOUT `workEveryNonFixedRestDay`.
 */
export function historicalSetupPayload(): string {
  const base = createEmptySector("drive")
  const sector: Record<string, unknown> = {
    ...base,
    name: "Drive",
    status: "active",
    weeklyDistribution: { monday: 15, tuesday: 15, wednesday: 15, thursday: 15, friday: 22, saturday: 18, sunday: 0 },
    hours: WEEK_DAYS.map((day) => ({ day, closed: day === "sunday", opensAt: "06:00", closesAt: "20:00" })),
    coverage: {
      standardDay: "monday",
      profiles: Object.fromEntries(
        OPEN_DAYS.map((day, index) => [
          day,
          PROFILES[index].map((employees, slot) => ({
            start: `${String(6 + slot).padStart(2, "0")}:00`,
            end: `${String(7 + slot).padStart(2, "0")}:00`,
            employees,
          })),
        ])
      ),
    },
    shiftRules: { ...base.shiftRules, minimumShiftDuration: 240, inheritMinimumShiftDuration: false, maximumDailyDuration: 600, splitShiftAllowed: true, maximumSplitDuration: 90 },
  }
  delete sector.workEveryNonFixedRestDay
  return JSON.stringify([sector])
}

export function readMigratedSectors(payload: string): SectorDemandConfiguration[] {
  const repository = createSectorRepository({
    getItem: () => payload,
    setItem: () => undefined,
  })
  return repository.list()
}

/** Translate the application records into the V2 input shape the builder reads. */
export function generationInput(
  records: readonly EmployeeRecord[],
  sectors: readonly SectorDemandConfiguration[]
): PlanningGenerationInput {
  const sector = sectors[0]
  const employees: Employee[] = records.map((record) => ({
    ...STAMPS,
    id: brand<EmployeeId>(record.id),
    storeId: brand<StoreId>("store_1"),
    contractId: brand<ContractId>(`contract_${record.id}`),
    firstName: record.firstName,
    lastName: record.lastName,
    phone: record.phone,
    email: record.email,
    status: record.status,
    capabilities: [
      ...(record.canOpen ? ["CAN_OPEN"] : []),
      ...(record.canClose ? ["CAN_CLOSE"] : []),
      ...(record.splitShiftAllowed ? ["CAN_SPLIT_SHIFT"] : []),
    ],
  }))

  const contracts: Contract[] = records.map((record) => ({
    ...STAMPS,
    id: brand<ContractId>(`contract_${record.id}`),
    employeeId: brand<EmployeeId>(record.id),
    contractType: record.contractType,
    weeklyMinutes: record.weeklyMinutes ?? undefined,
    weeklyHours: record.weeklyHours,
    workingDays: [...record.workingDays],
    minDailyHours: 4,
    maxDailyHours: 10,
  }))

  const requirements = DATES.flatMap((date, index) =>
    PROFILES[index].map((minEmployees, slot) => ({
      id: brand<never>(`req_${sector.id}_${date}_${String(6 + slot).padStart(2, "0")}00`),
      priority: "required" as never,
      minEmployees,
      window: {
        date,
        start: `${String(6 + slot).padStart(2, "0")}:00`,
        end: `${String(7 + slot).padStart(2, "0")}:00`,
      },
    }))
  )

  return {
    store: {
      ...STAMPS,
      id: brand<StoreId>("store_1"),
      organizationId: brand("org_1"),
      name: "Drive",
      address: "",
      city: "",
      postalCode: "",
      country: "France",
      timezone: "Europe/Paris",
      openingHours: WEEK_DAYS.map((day) =>
        day === "sunday"
          ? { day, closed: true, opensAt: null, closesAt: null }
          : { day, closed: false, opensAt: "06:00", closesAt: "20:00" }
      ),
      planningSettings: { mode: "dynamic", granularity: 15, minShiftDuration: 240, maxShiftDuration: 600 },
      splitShiftPolicy: { kind: "allowed", minSplitDuration: 15, maxSplitDuration: 90, maxSplitShiftsPerWeek: 6 },
    },
    employees,
    contracts,
    demand: { id: brand("demand_drive"), requirements },
    registry: {} as ConstraintRegistry,
    settings: {
      planningId: brand<PlanningId>("drive_historical"),
      period: PERIOD,
      now: "2026-07-01T00:00:00.000Z",
      mode: "dynamic",
      minimumRestMinutes: 720,
      maximumDailyMinutes: 600,
      timeIncrementMinutes: 15,
    },
    employeeConstraints: records.flatMap((record) => [
      ...record.fixedDaysOff.map((day, index) => ({
        id: brand<ConstraintId>(`off_${record.id}_${index}`),
        employeeId: brand<EmployeeId>(record.id),
        type: "FIXED_DAY_OFF" as const,
        day,
      })),
      ...(record.maxOpenings === null ? [] : [{ id: brand<ConstraintId>(`open_${record.id}`), employeeId: brand<EmployeeId>(record.id), type: "MAX_OPENINGS" as const, value: record.maxOpenings }]),
      ...(record.maxClosings === null ? [] : [{ id: brand<ConstraintId>(`close_${record.id}`), employeeId: brand<EmployeeId>(record.id), type: "MAX_CLOSINGS" as const, value: record.maxClosings }]),
    ]),
    business: {
      sectors: [
        {
          id: sector.id,
          name: sector.name,
          active: sector.status === "active",
          weeklyDistribution: sector.weeklyDistribution,
          minimumShiftDuration: sector.shiftRules.minimumShiftDuration ?? 0,
          splitShiftAllowed: sector.shiftRules.splitShiftAllowed,
          maximumSplitDuration: sector.shiftRules.maximumSplitDuration,
          workEveryNonFixedRestDay: sector.workEveryNonFixedRestDay,
          assignedEmployeeIds: records.map((record) => brand<EmployeeId>(record.id)),
          requirementIds: requirements.map((requirement) => String(requirement.id)),
          hours: sector.hours,
        },
      ],
      employeePreferences: records.map((record) => ({
        employeeId: brand<EmployeeId>(record.id),
        prefersClosing: record.preferClosing,
      })),
    },
  }
}

export function buildDriveProblem() {
  const sectors = readMigratedSectors(historicalSetupPayload())
  const built = buildPlanningProblemV3(generationInput(driveEmployeeRecords(), sectors))
  if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
  return built.problem
}

/**
 * The same builder under the name that says what it is for.
 *
 * Prefer this alias at new call sites: `buildDriveProblem` reads like "the"
 * Drive problem, which is exactly the confusion that let a migration fixture be
 * used as a performance reference for three sprints.
 */
export const buildLegacyMigrationDriveProblem = buildDriveProblem
