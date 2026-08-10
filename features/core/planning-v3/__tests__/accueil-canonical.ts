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
import { createEmptySector } from "@/features/sectors"

import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

/**
 * The Accueil sector, as a canonical problem.
 *
 * The second real scenario, and the one that exercises what Drive cannot:
 *
 * - HOURS THAT ARE NOT WHOLE. The sector runs 07:30 → 20:45. Nothing lands on
 *   the hour, which is exactly the case a coverage grid built on hourly
 *   assumptions gets wrong.
 * - TWO FLOORS OF DIFFERENT HEIGHTS. One person throughout, and two across the
 *   Saturday peak. Both come from the SECTOR's `minimumPresence`, and the
 *   builder resolves which slots each covers — no floor is injected by hand.
 * - A CONTRACT THAT FORCES A SPLIT. Ten hours on the single day one employee
 *   works, against an eight-hour continuous cap.
 * - UNEQUAL CONTRACTS AND SCATTERED REST DAYS, where Drive has five identical
 *   contracts and one rest pattern.
 *
 * Built through the real production builder, like `drive-canonical.ts`, and for
 * the same reason: a fixture that assembles a `PlanningProblemV3` by hand tests
 * the fixture.
 */

export const ACCUEIL_CANONICAL_RULES = {
  /** 07:30 and 20:45. */
  opensAtMinutes: 450,
  closesAtMinutes: 1_245,
  /** One person on the floor at every instant, every open day. */
  hardMinimumEmployees: 1,
  /** Two people across the Saturday peak, 10:00 → 18:30. */
  saturdayPeak: { from: "10:00", to: "18:30", employees: 2 },
  maximumOpeningsPerEmployee: 3,
  maximumClosingsPerEmployee: 2,
  minimumShiftMinutes: 240,
  maximumContinuousMinutes: 480,
  maximumShiftMinutes: 600,
  minimumSplitMinutes: 45,
  maximumSplitMinutes: 90,
  /** One coupure a day, never two. */
  maximumSplitsPerDay: 1,
  minimumRestMinutes: 720,
  minimumOpeningsPerDay: 1,
  exactClosingsPerDay: 1,
  timeStepMinutes: 15,
} as const

export const ACCUEIL_CANONICAL_DATES = [
  "2026-07-20", // lundi
  "2026-07-21", // mardi
  "2026-07-22", // mercredi
  "2026-07-23", // jeudi
  "2026-07-24", // vendredi
  "2026-07-25", // samedi
] as const

const STAMPS = { createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" }
const OPEN_DAYS = WEEK_DAYS.filter((day) => day !== "sunday")

function brand<T>(value: string): T {
  return value as unknown as T
}

interface AccueilPerson {
  readonly id: string
  readonly contractMinutes: number
  readonly restDays: readonly WeekDay[]
  readonly canSplitShift: boolean
}

export const ACCUEIL_TEAM: readonly AccueilPerson[] = [
  {
    id: "brigitte",
    contractMinutes: 1_920, // 32 h
    restDays: ["thursday", "sunday"],
    canSplitShift: false,
  },
  {
    id: "kenza",
    contractMinutes: 600, // 10 h, le samedi uniquement
    restDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "sunday"],
    canSplitShift: true,
  },
  {
    id: "marie",
    contractMinutes: 1_560, // 26 h
    restDays: ["tuesday", "wednesday", "sunday"],
    canSplitShift: false,
  },
  {
    id: "marine",
    contractMinutes: 2_205, // 36 h 45
    restDays: ["friday", "sunday"],
    canSplitShift: true,
  },
]

/**
 * Minutes to place each day.
 *
 * Chosen, not derived — the weekly distribution is a sector input. Saturday
 * carries the most because it is the only day needing two people across a long
 * peak. The six open days sum to the four contracts EXACTLY, which is a
 * precondition of the model rather than a coincidence: daily budgets are exact,
 * so a fixture whose totals disagree describes a problem with no solution.
 */
export const ACCUEIL_BUDGETS: Readonly<Record<WeekDay, number>> = {
  monday: 1_080,
  tuesday: 900,
  wednesday: 900,
  thursday: 900,
  friday: 900,
  saturday: 1_605,
  sunday: 0,
}

/** Hourly-equivalent demand profile, as `(start, end, employees)` per day. */
function demandWindowsFor(weekDay: WeekDay): readonly (readonly [string, string, number])[] {
  if (weekDay === "saturday") {
    return [
      ["07:30", "10:00", 1],
      ["10:00", "18:30", 2],
      ["18:30", "20:45", 1],
    ]
  }
  return [["07:30", "20:45", 1]]
}

export function accueilCanonicalInput(): PlanningGenerationInput {
  const base = createEmptySector("accueil")

  const employees: Employee[] = ACCUEIL_TEAM.map((person) => ({
    ...STAMPS,
    id: brand<EmployeeId>(person.id),
    storeId: brand<StoreId>("store_1"),
    contractId: brand<ContractId>(`contract_${person.id}`),
    firstName: person.id,
    lastName: "Accueil",
    phone: "",
    email: `${person.id}@accueil.test`,
    status: "active",
    capabilities: [
      "CAN_OPEN",
      "CAN_CLOSE",
      ...(person.canSplitShift ? ["CAN_SPLIT_SHIFT"] : []),
    ],
  }))

  const contracts: Contract[] = ACCUEIL_TEAM.map((person) => ({
    ...STAMPS,
    id: brand<ContractId>(`contract_${person.id}`),
    employeeId: brand<EmployeeId>(person.id),
    contractType: "part_time",
    weeklyMinutes: person.contractMinutes,
    weeklyHours: person.contractMinutes / 60,
    workingDays: OPEN_DAYS.filter((day) => !person.restDays.includes(day)),
    minDailyHours: ACCUEIL_CANONICAL_RULES.minimumShiftMinutes / 60,
    maxDailyHours: ACCUEIL_CANONICAL_RULES.maximumShiftMinutes / 60,
  }))

  const requirements = ACCUEIL_CANONICAL_DATES.flatMap((date, index) => {
    const weekDay = OPEN_DAYS[index]
    return demandWindowsFor(weekDay).map(([start, end, minEmployees]) => ({
      id: brand<never>(`req_accueil_${date}_${start.replace(":", "")}`),
      priority: "required" as never,
      minEmployees,
      window: { date, start, end },
    }))
  })

  return {
    store: {
      ...STAMPS,
      id: brand<StoreId>("store_1"),
      organizationId: brand("org_1"),
      name: "Accueil",
      address: "",
      city: "",
      postalCode: "",
      country: "France",
      timezone: "Europe/Paris",
      openingHours: WEEK_DAYS.map((day) =>
        day === "sunday"
          ? { day, closed: true, opensAt: null, closesAt: null }
          : { day, closed: false, opensAt: "07:30", closesAt: "20:45" }
      ),
      planningSettings: {
        mode: "dynamic",
        granularity: ACCUEIL_CANONICAL_RULES.timeStepMinutes,
        minShiftDuration: ACCUEIL_CANONICAL_RULES.minimumShiftMinutes,
        maxShiftDuration: ACCUEIL_CANONICAL_RULES.maximumShiftMinutes,
      },
      splitShiftPolicy: {
        kind: "allowed",
        minSplitDuration: ACCUEIL_CANONICAL_RULES.minimumSplitMinutes,
        maxSplitDuration: ACCUEIL_CANONICAL_RULES.maximumSplitMinutes,
        maxSplitShiftsPerWeek: 6,
      },
    },
    employees,
    contracts,
    demand: { id: brand("demand_accueil"), requirements },
    registry: {} as ConstraintRegistry,
    settings: {
      planningId: brand<PlanningId>("accueil_canonical"),
      period: { start: ACCUEIL_CANONICAL_DATES[0], end: "2026-07-26" },
      now: "2026-07-01T00:00:00.000Z",
      mode: "dynamic",
      minimumRestMinutes: ACCUEIL_CANONICAL_RULES.minimumRestMinutes,
      maximumDailyMinutes: ACCUEIL_CANONICAL_RULES.maximumShiftMinutes,
      timeIncrementMinutes: ACCUEIL_CANONICAL_RULES.timeStepMinutes,
    },
    employeeConstraints: ACCUEIL_TEAM.flatMap((person) => [
      ...person.restDays.map((day, index) => ({
        id: brand<ConstraintId>(`off_${person.id}_${index}`),
        employeeId: brand<EmployeeId>(person.id),
        type: "FIXED_DAY_OFF" as const,
        day,
      })),
      {
        id: brand<ConstraintId>(`open_${person.id}`),
        employeeId: brand<EmployeeId>(person.id),
        type: "MAX_OPENINGS" as const,
        value: ACCUEIL_CANONICAL_RULES.maximumOpeningsPerEmployee,
      },
      {
        id: brand<ConstraintId>(`close_${person.id}`),
        employeeId: brand<EmployeeId>(person.id),
        type: "MAX_CLOSINGS" as const,
        value: ACCUEIL_CANONICAL_RULES.maximumClosingsPerEmployee,
      },
    ]),
    business: {
      sectors: [
        {
          id: base.id,
          name: "Accueil",
          active: true,
          weeklyDistribution: {
            monday: 100 * (ACCUEIL_BUDGETS.monday / 6_285),
            tuesday: 100 * (ACCUEIL_BUDGETS.tuesday / 6_285),
            wednesday: 100 * (ACCUEIL_BUDGETS.wednesday / 6_285),
            thursday: 100 * (ACCUEIL_BUDGETS.thursday / 6_285),
            friday: 100 * (ACCUEIL_BUDGETS.friday / 6_285),
            saturday: 100 * (ACCUEIL_BUDGETS.saturday / 6_285),
            sunday: 0,
          },
          minimumShiftDuration: ACCUEIL_CANONICAL_RULES.minimumShiftMinutes,
          splitShiftAllowed: true,
          maximumSplitDuration: ACCUEIL_CANONICAL_RULES.maximumSplitMinutes,
          // Declared by the sector since the « Contraintes avancées » block, so
          // no rule survives only inside this file.
          maximumDailyDuration: ACCUEIL_CANONICAL_RULES.maximumShiftMinutes,
          maximumContinuousDuration: ACCUEIL_CANONICAL_RULES.maximumContinuousMinutes,
          minimumSplitDuration: ACCUEIL_CANONICAL_RULES.minimumSplitMinutes,
          maximumSplitsPerDay: ACCUEIL_CANONICAL_RULES.maximumSplitsPerDay,
          minimumOpeningsPerDay: ACCUEIL_CANONICAL_RULES.minimumOpeningsPerDay,
          requiredClosingsPerDay: ACCUEIL_CANONICAL_RULES.exactClosingsPerDay,
          minimumRestMinutes: ACCUEIL_CANONICAL_RULES.minimumRestMinutes,
          workEveryNonFixedRestDay: true,
          // The two floors, declared by the SECTOR. The builder decides which
          // slots each one covers; nothing is injected into the built problem.
          minimumPresence: [
            { employees: ACCUEIL_CANONICAL_RULES.hardMinimumEmployees },
            {
              day: "saturday",
              from: ACCUEIL_CANONICAL_RULES.saturdayPeak.from,
              to: ACCUEIL_CANONICAL_RULES.saturdayPeak.to,
              employees: ACCUEIL_CANONICAL_RULES.saturdayPeak.employees,
            },
          ],
          assignedEmployeeIds: ACCUEIL_TEAM.map((person) => brand<EmployeeId>(person.id)),
          requirementIds: requirements.map((requirement) => String(requirement.id)),
          hours: WEEK_DAYS.map((day) => ({
            day,
            closed: day === "sunday",
            opensAt: "07:30",
            closesAt: "20:45",
          })),
        },
      ],
      employeePreferences: ACCUEIL_TEAM.map((person) => ({
        employeeId: brand<EmployeeId>(person.id),
        prefersClosing: false,
      })),
    },
  }
}

/**
 * The canonical Accueil problem, built through the REAL production builder with
 * no override left: every rule is now declared by the sector and translated.
 */
export function buildAccueilCanonicalProblem(): PlanningProblemV3 {
  const built = buildPlanningProblemV3(accueilCanonicalInput())
  if (!built.ok) {
    throw new Error(
      `La fixture Accueil canonique ne se construit pas : ${built.errors
        .map((error) => `${error.code} — ${error.message}`)
        .join(" | ")}`
    )
  }

  return built.problem
}

export function serialiseAccueilCanonicalProblem(): string {
  return `${JSON.stringify(buildAccueilCanonicalProblem(), null, 2)}\n`
}
