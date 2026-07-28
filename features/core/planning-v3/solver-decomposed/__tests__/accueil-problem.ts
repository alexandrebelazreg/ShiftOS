import type { EmployeeId, IsoDate, PlanningId, WeekDay } from "@/features/core/models"
import type {
  PlanningDayV3,
  PlanningDemandSlotV3,
  PlanningEmployeeDayV3,
  PlanningEmployeeV3,
  PlanningProblemV3,
} from "@/features/core/planning-v3/types/problem"
import { PLANNING_PROBLEM_V3_VERSION } from "@/features/core/planning-v3/types/problem"

/**
 * The Accueil week — the second real scenario, and the one that exercises
 * everything the Drive week does not.
 *
 * What is new here, and why each part earns its place:
 *
 * - HOURS THAT ARE NOT WHOLE. The sector runs 07:30 → 20:45. Every start, end
 *   and demand boundary is a multiple of the fifteen-minute step and none of
 *   them is on the hour, which is exactly the case a coverage grid built on
 *   hourly assumptions gets wrong.
 * - A CONTRACT THAT FORCES A SPLIT. Kenza works ten hours on the one day she
 *   works. Ten hours exceeds the eight-hour continuous cap, so her Saturday is
 *   only legal as a split shift — the first scenario in the suite where a split
 *   is a CONSEQUENCE of a duration rather than a preference.
 * - TWO EMPLOYEES WHO MAY NOT SPLIT. Brigitte and Marie carry
 *   `canSplitShift: false`, so the same duration that is legal for Kenza is
 *   illegal for them.
 * - A SECOND, HIGHER FLOOR. Saturday needs two people from 10:00 to 18:30 on
 *   top of the one-person continuity that holds every day. Two floors of
 *   different heights over overlapping windows is what tells a correct atomic
 *   measurement from a lucky one.
 * - DAYS WITH ONLY TWO PEOPLE. Tuesday, Wednesday, Thursday and Friday are each
 *   staffed by exactly two employees who must, between them, open, close and
 *   keep the floor covered for thirteen and a quarter hours — while nobody may
 *   close one day and open the next, because the rest between 20:45 and 07:30
 *   is 645 minutes against a 720-minute rule.
 *
 * The books balance exactly: 6 285 contracted minutes against 6 285 budgeted
 * minutes. That is a precondition of the model, not a coincidence — daily
 * budgets are exact, so a fixture whose totals disagree describes a problem
 * with no solution at all, and would test nothing but the diagnostic.
 */

export const ACCUEIL_DATES = [
  "2026-07-20", // lundi
  "2026-07-21", // mardi
  "2026-07-22", // mercredi
  "2026-07-23", // jeudi
  "2026-07-24", // vendredi
  "2026-07-25", // samedi
  "2026-07-26", // dimanche — fermé
] as const

const WEEK_DAYS_IN_ORDER: readonly WeekDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]

/** 07:30 and 20:45, in minutes since midnight. */
export const ACCUEIL_OPENS_AT = 450
export const ACCUEIL_CLOSES_AT = 1_245
/** 10:00 and 18:30 — the Saturday reinforcement window. */
export const SATURDAY_PEAK_START = 600
export const SATURDAY_PEAK_END = 1_110

/** Exactly one person on the floor, at every instant, every open day. */
export const ACCUEIL_CONTINUITY_FLOOR = 1
/** Two people across the Saturday peak. "Au moins deux" — a floor, not a target. */
export const SATURDAY_PEAK_FLOOR = 2

export const ACCUEIL_MAXIMUM_OPENINGS = 3
export const ACCUEIL_MAXIMUM_CLOSINGS = 2

interface Person {
  readonly id: string
  readonly contractMinutes: number
  readonly restDays: readonly WeekDay[]
  readonly canSplitShift: boolean
}

export const ACCUEIL_TEAM: readonly Person[] = [
  {
    id: "kenza",
    contractMinutes: 600, // 10 h
    restDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "sunday"],
    canSplitShift: true,
  },
  {
    id: "marine",
    contractMinutes: 2_205, // 36 h 45
    restDays: ["friday", "sunday"],
    canSplitShift: true,
  },
  {
    id: "brigitte",
    contractMinutes: 1_920, // 32 h
    restDays: ["thursday", "sunday"],
    canSplitShift: false,
  },
  {
    id: "marie",
    contractMinutes: 1_560, // 26 h
    restDays: ["tuesday", "wednesday", "sunday"],
    canSplitShift: false,
  },
]

/**
 * Minutes to place each day.
 *
 * Chosen, not derived — the sector's weekly distribution is an input in the
 * real product. Saturday carries the most because it is the only day needing
 * two people across a long peak; Sunday is closed and carries none. The six
 * open days sum to the four contracts exactly.
 */
export const ACCUEIL_BUDGETS = [1_080, 900, 900, 900, 900, 1_605, 0] as const

export function buildAccueilProblem(): PlanningProblemV3 {
  const days: PlanningDayV3[] = ACCUEIL_DATES.map((date, index) => {
    const closed = index === 6
    return {
      date: date as IsoDate,
      weekDay: WEEK_DAYS_IN_ORDER[index],
      weekKey: "2026-W30",
      closed,
      opensAtMinutes: closed ? null : ACCUEIL_OPENS_AT,
      closesAtMinutes: closed ? null : ACCUEIL_CLOSES_AT,
      budgetMinutes: ACCUEIL_BUDGETS[index],
    }
  })

  const employees: PlanningEmployeeV3[] = ACCUEIL_TEAM.map((person) => ({
    id: person.id as unknown as EmployeeId,
    firstName: person.id,
    lastName: "Accueil",
    contractMinutes: person.contractMinutes,
    workingDays: WEEK_DAYS_IN_ORDER.filter((day) => !person.restDays.includes(day)),
    fixedRestDays: person.restDays,
    minimumDailyMinutes: 0,
    maximumDailyMinutes: 600,
    canOpen: true,
    canClose: true,
    canSplitShift: person.canSplitShift,
    maximumOpenings: ACCUEIL_MAXIMUM_OPENINGS,
    maximumClosings: ACCUEIL_MAXIMUM_CLOSINGS,
    prefersOpening: false,
    prefersClosing: false,
  }))

  const employeeDays: PlanningEmployeeDayV3[] = employees.flatMap((employee, employeeIndex) =>
    days.map((day) => {
      const person = ACCUEIL_TEAM[employeeIndex]
      const fixedRest = person.restDays.includes(day.weekDay)
      const available = !day.closed && !fixedRest
      return {
        employeeId: employee.id,
        date: day.date,
        available,
        mandatory: false,
        fixedRest,
        earliestStartMinutes: day.opensAtMinutes ?? 0,
        latestEndMinutes: day.closesAtMinutes ?? 0,
        maximumMinutes: available ? employee.maximumDailyMinutes : 0,
        ...(available ? {} : { unavailableReason: day.closed ? "closed" : "fixed-rest" }),
      }
    })
  )

  const demandSlots: PlanningDemandSlotV3[] = []
  for (const day of days) {
    if (day.closed) continue

    // The continuity floor, spanning the whole opening window.
    demandSlots.push({
      id: `continuity_${day.date}`,
      date: day.date,
      startMinutes: ACCUEIL_OPENS_AT,
      endMinutes: ACCUEIL_CLOSES_AT,
      requiredEmployees: ACCUEIL_CONTINUITY_FLOOR,
      hardMinimumEmployees: ACCUEIL_CONTINUITY_FLOOR,
      maximumEmployees: null,
    })

    if (day.weekDay === "saturday") {
      demandSlots.push({
        id: `peak_${day.date}`,
        date: day.date,
        startMinutes: SATURDAY_PEAK_START,
        endMinutes: SATURDAY_PEAK_END,
        requiredEmployees: SATURDAY_PEAK_FLOOR,
        hardMinimumEmployees: SATURDAY_PEAK_FLOOR,
        maximumEmployees: null,
      })
    }
  }

  return {
    version: PLANNING_PROBLEM_V3_VERSION,
    planningId: "accueil" as unknown as PlanningId,
    sectorId: "accueil",
    period: { start: ACCUEIL_DATES[0], end: ACCUEIL_DATES[6] },
    timeStepMinutes: 15,
    employees,
    days,
    employeeDays,
    demandSlots,
    rules: {
      minimumShiftMinutes: 240, // 4 h
      maximumShiftMinutes: 600, // 10 h sur la journée
      minimumRestMinutes: 720, // 12 h
      maximumConsecutiveWorkedDays: null,
      maximumConsecutiveWorkedDaysSource: "derived-fallback",
      splitShiftAllowed: true,
      minimumSplitMinutes: 45,
      maximumSplitMinutes: 90,
      maximumContinuousMinutes: 480, // 8 h d'affilée
      maximumSplitsPerDay: 1,
      minimumOpeningsPerDay: 1,
      exactClosingsPerDay: 1,
    },
    objectives: ["coverage-deficit"],
  }
}
