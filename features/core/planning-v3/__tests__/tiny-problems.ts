import type { EmployeeId, IsoDate, PlanningId } from "@/features/core/models"
import { PLANNING_OBJECTIVES_V3, PLANNING_PROBLEM_V3_VERSION } from "@/features/core/planning-v3/types/problem"
import type {
  PlanningDayV3,
  PlanningDemandSlotV3,
  PlanningEmployeeDayV3,
  PlanningEmployeeV3,
  PlanningProblemV3,
  PlanningRulesV3,
} from "@/features/core/planning-v3/types/problem"

/**
 * Deliberately tiny problems, small enough that every legal schedule can be
 * enumerated by hand — which is what makes an independent oracle possible.
 *
 * A 60-minute step over a four-hour window gives about ten candidates per
 * employee-day, so two employees over two days stay well under ten thousand
 * combinations. The real Drive week has 725 candidates per employee-day and
 * 2·10^14 assignments for a SINGLE day, so nothing there can be checked this
 * way; that is exactly why these fixtures exist.
 */

export interface TinyProblemOptions {
  readonly employees?: readonly {
    id: string
    contractMinutes: number
    canOpen?: boolean
    canClose?: boolean
    canSplitShift?: boolean
    maximumOpenings?: number | null
    maximumClosings?: number | null
    prefersClosing?: boolean
    restDays?: readonly IsoDate[]
    /** Individual hour bounds, already intersected with the sector's window. */
    earliestStartMinutes?: number
    latestEndMinutes?: number
  }[]
  readonly dates?: readonly IsoDate[]
  readonly budgetMinutes?: number | readonly number[]
  readonly openMinutes?: number
  readonly closeMinutes?: number
  readonly timeStepMinutes?: number
  readonly slotMinutes?: number
  readonly slotRequirement?: number | ((date: IsoDate, index: number) => number)
  readonly rules?: Partial<PlanningRulesV3>
}

const DEFAULT_DATES: readonly IsoDate[] = ["2026-07-20", "2026-07-21"]

function brand<T>(value: string): T {
  return value as unknown as T
}

export function tinyProblem(options: TinyProblemOptions = {}): PlanningProblemV3 {
  const dates = options.dates ?? DEFAULT_DATES
  const open = options.openMinutes ?? 480
  const close = options.closeMinutes ?? 720
  const step = options.timeStepMinutes ?? 60
  const slotMinutes = options.slotMinutes ?? 60

  const people = options.employees ?? [
    { id: "e1", contractMinutes: 240, canOpen: true, canClose: true },
    { id: "e2", contractMinutes: 240, canOpen: false, canClose: true },
  ]

  const employees: PlanningEmployeeV3[] = people.map((person) => ({
    id: brand<EmployeeId>(person.id),
    firstName: person.id,
    lastName: "Tiny",
    contractMinutes: person.contractMinutes,
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    fixedRestDays: [],
    minimumDailyMinutes: 0,
    maximumDailyMinutes: close - open,
    canOpen: person.canOpen ?? true,
    canClose: person.canClose ?? true,
    canSplitShift: person.canSplitShift ?? false,
    maximumOpenings: person.maximumOpenings ?? null,
    maximumClosings: person.maximumClosings ?? null,
    prefersOpening: false,
    prefersClosing: person.prefersClosing ?? false,
  }))

  const budgets = Array.isArray(options.budgetMinutes)
    ? options.budgetMinutes
    : dates.map(() => (typeof options.budgetMinutes === "number" ? options.budgetMinutes : 240))

  const days: PlanningDayV3[] = dates.map((date, index) => ({
    date,
    weekDay: "monday",
    weekKey: "2026-W30",
    closed: false,
    opensAtMinutes: open,
    closesAtMinutes: close,
    budgetMinutes: budgets[index],
  }))

  const employeeDays: PlanningEmployeeDayV3[] = []
  for (const [personIndex, person] of people.entries()) {
    for (const date of dates) {
      const resting = person.restDays?.includes(date) ?? false
      // An individual bound may only narrow the sector's window, exactly as the
      // builder intersects them.
      const earliest = Math.max(open, person.earliestStartMinutes ?? open)
      const latest = Math.min(close, person.latestEndMinutes ?? close)
      employeeDays.push({
        employeeId: employees[personIndex].id,
        date,
        available: !resting,
        // Every available day is mandatory, mirroring the Drive sector rule.
        mandatory: !resting,
        fixedRest: resting,
        earliestStartMinutes: earliest,
        latestEndMinutes: latest,
        maximumMinutes: resting ? 0 : Math.max(0, latest - earliest),
        unavailableReason: resting ? "fixed-rest" : undefined,
      })
    }
  }

  const demandSlots: PlanningDemandSlotV3[] = []
  for (const date of dates) {
    let index = 0
    for (let start = open; start + slotMinutes <= close; start += slotMinutes) {
      const requirement =
        typeof options.slotRequirement === "function"
          ? options.slotRequirement(date, index)
          : (options.slotRequirement ?? 1)
      demandSlots.push({
        id: `${date}_${start}`,
        date,
        startMinutes: start,
        endMinutes: start + slotMinutes,
        requiredEmployees: requirement,
        maximumEmployees: null,
      })
      index++
    }
  }

  return {
    version: PLANNING_PROBLEM_V3_VERSION,
    planningId: brand<PlanningId>("tiny"),
    sectorId: "tiny",
    period: { start: dates[0], end: dates[dates.length - 1] },
    timeStepMinutes: step,
    employees,
    days,
    employeeDays,
    demandSlots,
    rules: {
      minimumShiftMinutes: 60,
      maximumShiftMinutes: close - open,
      minimumRestMinutes: 0,
      maximumConsecutiveWorkedDays: null,
      maximumConsecutiveWorkedDaysSource: "configured",
      splitShiftAllowed: false,
      maximumSplitMinutes: null,
      minimumOpeningsPerDay: 1,
      exactClosingsPerDay: 1,
      ...options.rules,
    },
    objectives: PLANNING_OBJECTIVES_V3,
  }
}
