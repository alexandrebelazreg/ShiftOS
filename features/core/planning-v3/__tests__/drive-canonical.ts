import type {
  ConstraintId,
  Contract,
  ContractId,
  Employee,
  EmployeeId,
  IsoDate,
  PlanningId,
  StoreId,
} from "@/features/core/models"
import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { ConstraintRegistry } from "@/features/core/constraint-engine"
import type { PlanningGenerationInput } from "@/features/core/planning-generator/types/generation-input"
import { createEmptySector } from "@/features/sectors"

import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type {
  PlanningEmployeeDayV3,
  PlanningProblemV3,
} from "@/features/core/planning-v3/types/problem"
import type {
  PlanningAssignmentV3,
  PlanningSolutionV3,
} from "@/features/core/planning-v3/types/solution"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem } from "@/features/core/planning-v3/validator"

/**
 * THE canonical Drive problem — the single reference every engine comparison
 * must use.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 *
 * The previous Drive fixture (`drive-problem.ts`) was written to guard a
 * MIGRATION: it starts from a legacy sector payload missing
 * `workEveryNonFixedRestDay` and drives it through the repository migration.
 * That is a valuable test and it keeps its job. What it is NOT is a statement
 * of the Drive business rules — and it was being used as one.
 *
 * A parity experiment made the cost visible. The Python reference schedule,
 * which covers the week with ZERO shortfall, was rejected by the validator on
 * that fixture with four blocking violations. None of them came from the
 * builder, which implements the rules correctly; all four came from fixture
 * data that never matched the rules actually decided:
 *
 * | Violation | Fixture said | Canonical rule |
 * |---|---|---|
 * | `maximum-openings` on one employee | `MAX_OPENINGS = 1` | no individual opening limit |
 * | `maximum-closings` on two employees | `MAX_CLOSINGS = 1` | at most 2 closings each |
 * | `mandatory-day` | every open day contracted | one employee rests Wednesday |
 *
 * Comparing two engines across two different problems is not a comparison, so
 * the rules are restated here ONCE, in `DRIVE_CANONICAL_RULES`, and the problem
 * is built from them through the real production builder.
 *
 * ── What is asserted about this fixture ───────────────────────────────────
 *
 * `drive-canonical.test.ts` pins every rule below, and pins that the reference
 * schedule is legal at 0 shortfalls and 0 deficit minutes. A change to the
 * builder, the rules or the schedule that breaks the agreement turns that suite
 * red rather than silently moving the bar.
 */

/**
 * The Drive business rules, stated once.
 *
 * Read by the fixture AND by the tests, so a rule cannot be changed in one and
 * quietly disagree with the other.
 */
export const DRIVE_CANONICAL_RULES = {
  /** Exact weekly contract, identical for everyone. */
  contractMinutes: 2_205,
  /** Minutes each open day must receive, all employees combined. Exact. */
  dailyBudgetMinutes: {
    monday: 1_650,
    tuesday: 1_650,
    wednesday: 1_650,
    thursday: 1_650,
    friday: 2_430,
    saturday: 1_995,
  } as const,
  opensAtMinutes: 360, // 06:00
  closesAtMinutes: 1_200, // 20:00
  /** One employee may not start before 08:00. */
  earliestStartOverrides: { dylan: 480 } as const,
  /** Fixed rest days, which `workEveryNonFixedRestDay` may never override. */
  fixedRestDays: { arthur: "thursday", luca: "wednesday" } as const,
  /**
   * At least one person on the floor at every instant the Drive is open.
   *
   * The UNBREAKABLE minimum, as opposed to the hourly head-count profile, which
   * is a target. A schedule missing the target is short-staffed; a schedule
   * missing this one has left the Drive unattended, and the validator refuses
   * to publish it.
   *
   * No sector configuration field carries an operational floor yet, so the
   * builder cannot produce it — see the note on `buildDriveCanonicalProblem`.
   */
  hardMinimumEmployees: 1,
  /** At most two closings each. No individual opening limit for anyone. */
  maximumClosingsPerEmployee: 2,
  maximumOpeningsPerEmployee: null,
  /** Only one employee may work a split shift. */
  splitShiftAllowedFor: "arthur",
  minimumShiftMinutes: 240,
  /** Longest uninterrupted stretch. A longer day is only legal as a split. */
  maximumContinuousMinutes: 480,
  /** Longest day, split included. */
  maximumShiftMinutes: 600,
  minimumSplitMinutes: 45,
  maximumSplitMinutes: 90,
  minimumRestMinutes: 720,
  minimumOpeningsPerDay: 1,
  exactClosingsPerDay: 1,
  timeStepMinutes: 15,
} as const

export const DRIVE_CANONICAL_DATES = [
  "2026-07-20", // lundi
  "2026-07-21", // mardi
  "2026-07-22", // mercredi
  "2026-07-23", // jeudi
  "2026-07-24", // vendredi
  "2026-07-25", // samedi
] as const

export const DRIVE_CANONICAL_PERIOD = {
  start: DRIVE_CANONICAL_DATES[0],
  end: "2026-07-26",
} as const

/** Hourly head-count per open day, 06:00 → 20:00. Unchanged from the sector. */
const PROFILES = [
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 2, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 1, 1],
  [2, 1, 3, 1, 4, 1, 1, 1, 1, 1, 3, 2, 1, 1],
  [4, 1, 1, 1, 1, 4, 1, 1, 1, 1, 1, 1, 1, 1],
] as const

export const DRIVE_OPEN_WEEK_DAYS = WEEK_DAYS.filter((day) => day !== "sunday")
const OPEN_DAYS = DRIVE_OPEN_WEEK_DAYS
const STAMPS = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }

/**
 * How the sector spreads the week's contracted minutes.
 *
 * A business shape — Friday heaviest, then Saturday — not a derived figure.
 * Exported so a scenario built on top of Drive can start from the same shape
 * instead of restating it and drifting.
 */
export const DRIVE_SECTOR_DISTRIBUTION: Readonly<Record<WeekDay, number>> = {
  monday: 15,
  tuesday: 15,
  wednesday: 15,
  thursday: 15,
  friday: 22,
  saturday: 18,
  sunday: 0,
}

function brand<T>(value: string): T {
  return value as unknown as T
}

export interface CanonicalPerson {
  readonly id: string
  readonly fixedRestDay: WeekDay | null
  readonly canSplitShift: boolean
}

export const DRIVE_TEAM_SHAPE: readonly CanonicalPerson[] = [
  { id: "arthur", fixedRestDay: "thursday", canSplitShift: true },
  { id: "dylan", fixedRestDay: null, canSplitShift: false },
  { id: "erwan", fixedRestDay: null, canSplitShift: false },
  { id: "luca", fixedRestDay: "wednesday", canSplitShift: false },
  { id: "valentin", fixedRestDay: null, canSplitShift: false },
]

function workingDaysOf(person: CanonicalPerson): WeekDay[] {
  return OPEN_DAYS.filter((day) => day !== person.fixedRestDay)
}

/**
 * The application input, built from the canonical rules.
 *
 * `workEveryNonFixedRestDay` is declared TRUE and explicitly: everyone works
 * every day that is not one of their fixed rest days. The builder already
 * refuses to make a fixed rest day mandatory — `available` excludes it before
 * `mandatory` is computed — and `drive-canonical.test.ts` pins that, because it
 * is the rule the previous fixture violated by omission.
 */
export function driveCanonicalInput(): PlanningGenerationInput {
  const base = createEmptySector("drive")

  const employees: Employee[] = DRIVE_TEAM_SHAPE.map((person) => ({
    ...STAMPS,
    id: brand<EmployeeId>(person.id),
    storeId: brand<StoreId>("store_1"),
    contractId: brand<ContractId>(`contract_${person.id}`),
    firstName: person.id,
    lastName: "Drive",
    phone: "",
    email: `${person.id}@drive.test`,
    status: "active",
    capabilities: [
      "CAN_OPEN",
      "CAN_CLOSE",
      ...(person.canSplitShift ? ["CAN_SPLIT_SHIFT"] : []),
    ],
  }))

  const contracts: Contract[] = DRIVE_TEAM_SHAPE.map((person) => ({
    ...STAMPS,
    id: brand<ContractId>(`contract_${person.id}`),
    employeeId: brand<EmployeeId>(person.id),
    contractType: "full_time",
    weeklyMinutes: DRIVE_CANONICAL_RULES.contractMinutes,
    weeklyHours: DRIVE_CANONICAL_RULES.contractMinutes / 60,
    workingDays: workingDaysOf(person),
    minDailyHours: DRIVE_CANONICAL_RULES.minimumShiftMinutes / 60,
    maxDailyHours: DRIVE_CANONICAL_RULES.maximumShiftMinutes / 60,
  }))

  const requirements = DRIVE_CANONICAL_DATES.flatMap((date, index) =>
    PROFILES[index].map((minEmployees, slot) => ({
      id: brand<never>(`req_drive_${date}_${String(6 + slot).padStart(2, "0")}00`),
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
      planningSettings: {
        mode: "dynamic",
        granularity: DRIVE_CANONICAL_RULES.timeStepMinutes,
        minShiftDuration: DRIVE_CANONICAL_RULES.minimumShiftMinutes,
        maxShiftDuration: DRIVE_CANONICAL_RULES.maximumShiftMinutes,
      },
      splitShiftPolicy: {
        kind: "allowed",
        minSplitDuration: DRIVE_CANONICAL_RULES.minimumSplitMinutes,
        maxSplitDuration: DRIVE_CANONICAL_RULES.maximumSplitMinutes,
        maxSplitShiftsPerWeek: 6,
      },
    },
    employees,
    contracts,
    demand: { id: brand("demand_drive"), requirements },
    registry: {} as ConstraintRegistry,
    settings: {
      planningId: brand<PlanningId>("drive_canonical"),
      period: { start: DRIVE_CANONICAL_PERIOD.start, end: DRIVE_CANONICAL_PERIOD.end },
      now: "2026-07-01T00:00:00.000Z",
      mode: "dynamic",
      minimumRestMinutes: DRIVE_CANONICAL_RULES.minimumRestMinutes,
      maximumDailyMinutes: DRIVE_CANONICAL_RULES.maximumShiftMinutes,
      timeIncrementMinutes: DRIVE_CANONICAL_RULES.timeStepMinutes,
    },
    employeeConstraints: DRIVE_TEAM_SHAPE.flatMap((person) => [
      ...(person.fixedRestDay === null
        ? []
        : [
            {
              id: brand<ConstraintId>(`off_${person.id}`),
              employeeId: brand<EmployeeId>(person.id),
              type: "FIXED_DAY_OFF" as const,
              day: person.fixedRestDay,
            },
          ]),
      // Sunday is closed for the sector; declaring it keeps the contract and the
      // constraints saying the same thing.
      {
        id: brand<ConstraintId>(`off_sunday_${person.id}`),
        employeeId: brand<EmployeeId>(person.id),
        type: "FIXED_DAY_OFF" as const,
        day: "sunday" as WeekDay,
      },
      // At most two closings each. NO individual opening cap for anyone — the
      // previous fixture's `MAX_OPENINGS = 1` was not a decided rule.
      {
        id: brand<ConstraintId>(`close_${person.id}`),
        employeeId: brand<EmployeeId>(person.id),
        type: "MAX_CLOSINGS" as const,
        value: DRIVE_CANONICAL_RULES.maximumClosingsPerEmployee,
      },
    ]),
    business: {
      sectors: [
        {
          id: base.id,
          name: "Drive",
          active: true,
          weeklyDistribution: DRIVE_SECTOR_DISTRIBUTION,
          minimumShiftDuration: DRIVE_CANONICAL_RULES.minimumShiftMinutes,
          splitShiftAllowed: true,
          maximumSplitDuration: DRIVE_CANONICAL_RULES.maximumSplitMinutes,
          // Declared, never guessed. A fixed rest day still wins — see the note
          // on this function.
          workEveryNonFixedRestDay: true,
          // The unbreakable floor, declared by the SECTOR and translated by the
          // builder. It used to be injected into the built problem by this
          // fixture, which meant the rule existed only in tests: a real Drive
          // reaching the engine carried no floor at all.
          minimumPresence: [{ employees: DRIVE_CANONICAL_RULES.hardMinimumEmployees }],
          assignedEmployeeIds: DRIVE_TEAM_SHAPE.map((person) => brand<EmployeeId>(person.id)),
          requirementIds: requirements.map((requirement) => String(requirement.id)),
          hours: WEEK_DAYS.map((day) => ({
            day,
            closed: day === "sunday",
            opensAt: "06:00",
            closesAt: "20:00",
          })),
        },
      ],
      employeePreferences: DRIVE_TEAM_SHAPE.map((person) => ({
        employeeId: brand<EmployeeId>(person.id),
        prefersClosing: false,
      })),
    },
  }
}

/**
 * The canonical problem.
 *
 * Built through the REAL production builder, then given the three rules the
 * application configuration cannot express yet. All are applied by NARROWING
 * the built problem, never by widening it:
 *
 * - `earliestStartMinutes` per employee — the model supports it, the validator
 *   enforces it, but no constraint type carries an hour bound yet (see the
 *   extension point in `build-problem.ts`);
 * - `maximumContinuousMinutes` — no sector field declares it, so the builder
 *   leaves it null rather than defaulting it to the daily maximum, which would
 *   make "ten hours in one block" legal by omission.
 *
 * `hardMinimumEmployees` used to be a third override and is NOT one any more:
 * the sector now carries `minimumPresence` and the builder translates it onto
 * every slot it covers. That matters beyond tidiness — while the floor was
 * injected here, the rule existed only inside this file, and a real Drive
 * reaching the engine carried no floor at all.
 *
 * Both remaining overrides are KNOWN GAPS in the application model, not
 * shortcuts: the day a configuration field exists, the override disappears and
 * the builder produces the value. `drive-canonical.test.ts` pins each one so a
 * gap cannot be closed silently or widened accidentally.
 */
export function buildDriveCanonicalProblem(): PlanningProblemV3 {
  const built = buildPlanningProblemV3(driveCanonicalInput())
  if (!built.ok) {
    throw new Error(
      `La fixture Drive canonique ne se construit pas : ${built.errors
        .map((error) => `${error.code} — ${error.message}`)
        .join(" | ")}`
    )
  }

  const overrides = DRIVE_CANONICAL_RULES.earliestStartOverrides as Readonly<
    Record<string, number>
  >

  const employeeDays: PlanningEmployeeDayV3[] = built.problem.employeeDays.map((entry) => {
    const override = overrides[String(entry.employeeId)]
    if (override === undefined) return entry
    const earliest = Math.max(entry.earliestStartMinutes, override)
    return {
      ...entry,
      earliestStartMinutes: earliest,
      maximumMinutes: Math.min(
        entry.maximumMinutes,
        Math.max(0, entry.latestEndMinutes - earliest)
      ),
    }
  })

  return {
    ...built.problem,
    employeeDays,
    rules: {
      ...built.problem.rules,
      maximumContinuousMinutes: DRIVE_CANONICAL_RULES.maximumContinuousMinutes,
      minimumSplitMinutes: DRIVE_CANONICAL_RULES.minimumSplitMinutes,
    },
  }
}

/** The problem as JSON, for the Python spike and for any cross-language check. */
export function serialiseDriveCanonicalProblem(): string {
  return `${JSON.stringify(buildDriveCanonicalProblem(), null, 2)}\n`
}

/**
 * The Python/HiGHS reference schedule for this problem.
 *
 * Kept as clock strings because that is how it was read and reviewed by a human;
 * the conversion to minutes happens once, below, so a transcription error shows
 * up as an obviously wrong hour rather than as an off-by-fifteen integer.
 *
 * `null` is a rest day. A two-element row is a split shift.
 */
export const DRIVE_CANONICAL_REFERENCE: Readonly<
  Record<string, readonly (readonly (readonly [string, string])[] | null)[]>
> = {
  dylan: [
    [["08:15", "12:15"]],
    [["09:15", "13:30"]],
    [["10:00", "17:00"]],
    [["09:45", "17:30"]],
    [["12:30", "20:00"]],
    [["13:45", "20:00"]],
  ],
  valentin: [
    [["06:00", "11:00"]],
    [["06:00", "12:00"]],
    [["06:00", "12:00"]],
    [["06:00", "12:00"]],
    [["06:00", "13:45"]],
    [["06:00", "12:00"]],
  ],
  arthur: [
    [["06:00", "12:30"]],
    [["13:30", "20:00"]],
    [["13:00", "20:00"]],
    null,
    [
      ["06:00", "11:00"],
      ["12:30", "17:00"],
    ],
    [["06:00", "13:15"]],
  ],
  luca: [
    [["10:30", "17:00"]],
    [["06:00", "12:30"]],
    null,
    [["06:00", "14:00"]],
    [["10:00", "18:00"]],
    [["06:00", "13:45"]],
  ],
  erwan: [
    [["14:30", "20:00"]],
    [["13:45", "18:00"]],
    [["06:00", "13:30"]],
    [["14:15", "20:00"]],
    [["08:00", "15:45"]],
    [["06:00", "12:00"]],
  ],
}

function minutesOfClock(value: string): number {
  const [hours, minutes] = value.split(":")
  return Number(hours) * 60 + Number(minutes)
}

/** The reference schedule as a `PlanningSolutionV3` the validator can audit. */
export function driveCanonicalReferenceSolution(
  problem: PlanningProblemV3
): PlanningSolutionV3 {
  const assignments: PlanningAssignmentV3[] = Object.entries(DRIVE_CANONICAL_REFERENCE)
    .flatMap(([employeeId, week]) =>
      week.flatMap((day, index) =>
        day === null
          ? []
          : [
              {
                employeeId: employeeId as unknown as EmployeeId,
                date: DRIVE_CANONICAL_DATES[index] as IsoDate,
                segments: day.map(([from, to]) => ({
                  startMinutes: minutesOfClock(from),
                  endMinutes: minutesOfClock(to),
                })),
              },
            ]
      )
    )
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        String(left.employeeId).localeCompare(String(right.employeeId))
    )

  return {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprintProblem(problem),
    assignments,
  }
}

/**
 * What the reference schedule is expected to measure on the canonical problem.
 *
 * The whole point of the alignment: a legal schedule covering the week with
 * nothing missing. Any engine's result is compared against THIS, on THIS
 * problem, and never against a number produced on a different one.
 */
export const DRIVE_CANONICAL_EXPECTED = {
  validHardConstraints: true,
  underCoveredSlots: 0,
  deficitMinutes: 0,
  assignments: 28,
  splitShifts: 1,
} as const
