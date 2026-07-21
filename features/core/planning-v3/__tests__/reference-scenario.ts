import type {
  ConstraintId,
  Contract,
  ContractId,
  Employee,
  EmployeeId,
  IsoDate,
  PlanningId,
  StoreId,
  WeekDay,
} from "@/features/core/models"
import { WEEK_DAYS } from "@/features/core/models"
import type { ConstraintRegistry } from "@/features/core/constraint-engine"
import type { PlanningGenerationInput } from "@/features/core/planning-generator/types/generation-input"

import type {
  PlanningAssignmentV3,
  PlanningSolutionV3,
} from "@/features/core/planning-v3/types/solution"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"

/**
 * A small reference scenario with a hand-verified LEGAL solution.
 *
 * The mutation tests need a solution that is known-good on every rule at once,
 * so that corrupting one thing makes exactly one thing fail. Four employees on
 * six open days give enough slack for that; the real Drive week does not, which
 * is why the end-to-end Drive case validates the PROBLEM instead.
 *
 * The numbers are chosen so every invariant closes exactly:
 * - 4 contracts of 1 800 minutes → 7 200 minutes to place;
 * - a 15/15/15/15/20/20 weekly split → budgets 1 080 ×4 and 1 440 ×2;
 * - so every employee works 270 minutes Monday–Thursday and 360 on Friday and
 *   Saturday, and both the daily budgets and the weekly contracts land on the
 *   nose with no rounding left over.
 */

const STORE_OPEN_MINUTES = 360 // 06:00
const STORE_CLOSE_MINUTES = 1200 // 20:00

export const REFERENCE_DATES: readonly IsoDate[] = [
  "2026-07-20", // monday
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
  "2026-07-25", // saturday
]

/** Roles are what makes the schedule legal; the times follow from them. */
type Role = "opener" | "midA" | "midB" | "closer"

/** Short-day (Mon–Thu, 270 min) and long-day (Fri–Sat, 360 min) shift shapes. */
const SHORT_DAY: Record<Role, readonly [number, number]> = {
  opener: [360, 630],
  midA: [600, 870],
  midB: [840, 1110],
  closer: [930, 1200],
}
const LONG_DAY: Record<Role, readonly [number, number]> = {
  opener: [360, 720],
  midA: [540, 900],
  midB: [780, 1140],
  closer: [840, 1200],
}

/**
 * Who plays which role each day.
 *
 * Two constraints shape this rota and both are load-bearing:
 * - Dylan has no CAN_OPEN, so he never takes `opener`;
 * - a 720-minute rest means whoever ends late cannot open the next morning, so
 *   the next day's opener is always the previous day's opener or `midA`.
 */
const ROTA: readonly Record<Role, string>[] = [
  { opener: "alice", midA: "bruno", midB: "chloe", closer: "dylan" }, // monday
  { opener: "alice", midA: "bruno", midB: "chloe", closer: "dylan" },
  { opener: "bruno", midA: "alice", midB: "dylan", closer: "chloe" },
  { opener: "alice", midA: "chloe", midB: "dylan", closer: "bruno" },
  { opener: "chloe", midA: "dylan", midB: "bruno", closer: "alice" },
  { opener: "chloe", midA: "bruno", midB: "dylan", closer: "alice" }, // saturday
]

/**
 * The baseline uses 3 openings for Alice and 1 closing for Chloé, so the caps
 * below leave one slot of headroom each. That headroom is deliberate: it lets a
 * mutation move a single shift around to break ONE rule without tripping the
 * opening/closing caps as a side effect.
 */
const PEOPLE = [
  { id: "alice", canOpen: true, canClose: true, maxOpenings: 4, maxClosings: 2 },
  { id: "bruno", canOpen: true, canClose: true, maxOpenings: 3, maxClosings: 1 },
  { id: "chloe", canOpen: true, canClose: true, maxOpenings: 3, maxClosings: 2 },
  { id: "dylan", canOpen: false, canClose: true, maxOpenings: null, maxClosings: 2 },
] as const

function brand<T>(value: string): T {
  return value as unknown as T
}

const STAMPS = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }

/** The application-level input the V3 builder translates. */
export function referenceInput(): PlanningGenerationInput {
  const openDays = WEEK_DAYS.filter((day) => day !== "sunday")

  const employees: Employee[] = PEOPLE.map((person) => ({
    ...STAMPS,
    id: brand<EmployeeId>(person.id),
    storeId: brand<StoreId>("store_1"),
    contractId: brand<ContractId>(`contract_${person.id}`),
    firstName: person.id,
    lastName: "Reference",
    phone: "",
    email: `${person.id}@reference.test`,
    status: "active",
    capabilities: [
      ...(person.canOpen ? ["CAN_OPEN"] : []),
      ...(person.canClose ? ["CAN_CLOSE"] : []),
    ],
  }))

  const contracts: Contract[] = PEOPLE.map((person) => ({
    ...STAMPS,
    id: brand<ContractId>(`contract_${person.id}`),
    employeeId: brand<EmployeeId>(person.id),
    contractType: "part_time",
    weeklyMinutes: 1_800,
    weeklyHours: 30,
    workingDays: [...openDays],
    minDailyHours: 4,
    maxDailyHours: 10,
  }))

  const requirements = REFERENCE_DATES.flatMap((date) =>
    Array.from({ length: 14 }, (_, slot) => {
      const start = 6 + slot
      return {
        id: brand<never>(`ref_${date}_${start}`),
        priority: "required" as never,
        minEmployees: 1,
        window: {
          date,
          start: `${String(start).padStart(2, "0")}:00`,
          end: `${String(start + 1).padStart(2, "0")}:00`,
        },
      }
    })
  )

  return {
    store: {
      ...STAMPS,
      id: brand<StoreId>("store_1"),
      organizationId: brand("org_1"),
      name: "Reference",
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
        granularity: 15,
        minShiftDuration: 240,
        maxShiftDuration: 600,
      },
      splitShiftPolicy: {
        kind: "forbidden",
        minSplitDuration: null,
        maxSplitDuration: null,
        maxSplitShiftsPerWeek: null,
      },
    },
    employees,
    contracts,
    demand: { id: brand("demand_reference"), requirements },
    // The builder never runs constraints; the registry is part of the V2 input
    // shape only. An empty stub keeps the fixture honest about that.
    registry: {} as ConstraintRegistry,
    settings: {
      planningId: brand<PlanningId>("reference"),
      period: { start: REFERENCE_DATES[0], end: REFERENCE_DATES[5] },
      now: "2026-07-01T00:00:00.000Z",
      mode: "dynamic",
      minimumRestMinutes: 720,
      maximumDailyMinutes: 600,
      timeIncrementMinutes: 15,
    },
    employeeConstraints: PEOPLE.flatMap((person) => [
      ...(person.maxOpenings === null
        ? []
        : [
            {
              id: brand<ConstraintId>(`max_open_${person.id}`),
              employeeId: brand<EmployeeId>(person.id),
              type: "MAX_OPENINGS" as const,
              value: person.maxOpenings,
            },
          ]),
      {
        id: brand<ConstraintId>(`max_close_${person.id}`),
        employeeId: brand<EmployeeId>(person.id),
        type: "MAX_CLOSINGS" as const,
        value: person.maxClosings,
      },
    ]),
    business: {
      sectors: [
        {
          id: "reference",
          name: "Référence",
          active: true,
          weeklyDistribution: {
            monday: 15,
            tuesday: 15,
            wednesday: 15,
            thursday: 15,
            friday: 20,
            saturday: 20,
            sunday: 0,
          },
          minimumShiftDuration: 240,
          splitShiftAllowed: false,
          maximumSplitDuration: null,
          workEveryNonFixedRestDay: true,
          assignedEmployeeIds: PEOPLE.map((person) => brand<EmployeeId>(person.id)),
          requirementIds: requirements.map((requirement) => String(requirement.id)),
          hours: WEEK_DAYS.map((day) => ({
            day,
            closed: day === "sunday",
            opensAt: "06:00",
            closesAt: "20:00",
          })),
        },
      ],
      employeePreferences: [],
    },
  }
}

/** The hand-verified legal solution for `referenceInput()`. */
export function referenceSolution(problemFingerprint = ""): PlanningSolutionV3 {
  const assignments: PlanningAssignmentV3[] = []
  for (const [index, date] of REFERENCE_DATES.entries()) {
    const shapes = index < 4 ? SHORT_DAY : LONG_DAY
    for (const role of ["opener", "midA", "midB", "closer"] as const) {
      const [startMinutes, endMinutes] = shapes[role]
      assignments.push({
        employeeId: brand<EmployeeId>(ROTA[index][role]),
        date,
        segments: [{ startMinutes, endMinutes }],
      })
    }
  }
  return {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint,
    assignments: sortAssignments(assignments),
  }
}

/** Replace one employee's day, keeping every other assignment untouched. */
export function withDay(
  solution: PlanningSolutionV3,
  employeeId: string,
  date: IsoDate,
  segments: readonly { startMinutes: number; endMinutes: number }[]
): PlanningSolutionV3 {
  const others = solution.assignments.filter(
    (assignment) => !(String(assignment.employeeId) === employeeId && assignment.date === date)
  )
  const next =
    segments.length === 0
      ? others
      : [...others, { employeeId: brand<EmployeeId>(employeeId), date, segments }]
  return { ...solution, assignments: sortAssignments(next) }
}

export { STORE_CLOSE_MINUTES, STORE_OPEN_MINUTES }

export const REFERENCE_WEEK_DAYS: readonly WeekDay[] = WEEK_DAYS.filter((day) => day !== "sunday")

function sortAssignments(
  assignments: readonly PlanningAssignmentV3[]
): PlanningAssignmentV3[] {
  return [...assignments].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      String(left.employeeId).localeCompare(String(right.employeeId))
  )
}
