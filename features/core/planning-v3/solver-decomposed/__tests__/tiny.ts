import type { EmployeeId, IsoDate, PlanningId, WeekDay } from "@/features/core/models"
import type {
  PlanningDayV3,
  PlanningDemandSlotV3,
  PlanningEmployeeDayV3,
  PlanningEmployeeV3,
  PlanningProblemV3,
  PlanningRulesV3,
} from "@/features/core/planning-v3/types/problem"
import { PLANNING_PROBLEM_V3_VERSION } from "@/features/core/planning-v3/types/problem"

/**
 * Small, hand-built problems for the unit tests.
 *
 * Deliberately tiny — two or three employees over two or three days — so each
 * test isolates ONE rule and runs in milliseconds. The Drive and Accueil
 * scenarios exercise the engine at realistic size; these exercise it at a size
 * where a failure points at a single line.
 *
 * Everything is explicit. No helper here derives a value from another, because
 * a fixture that computes its own budget cannot be used to test that the engine
 * respects the budget.
 */

const WEEK_DAY_BY_INDEX: readonly WeekDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]

export const TINY_DATES = ["2026-07-20", "2026-07-21", "2026-07-22"] as const

export interface TinyEmployee {
  readonly id: string
  readonly contractMinutes: number
  readonly minimumDailyMinutes?: number
  readonly maximumDailyMinutes?: number
  readonly canOpen?: boolean
  readonly canClose?: boolean
  readonly canSplitShift?: boolean
  readonly maximumOpenings?: number | null
  readonly maximumClosings?: number | null
}

export interface TinyDay {
  readonly budgetMinutes: number
  readonly opensAtMinutes?: number
  readonly closesAtMinutes?: number
  readonly closed?: boolean
}

export interface TinySlot {
  readonly startMinutes: number
  readonly endMinutes: number
  readonly requiredEmployees: number
  readonly hardMinimumEmployees?: number
  /** Index into the day list; defaults to every open day. */
  readonly dayIndex?: number
}

export interface TinySpec {
  readonly employees: readonly TinyEmployee[]
  readonly days: readonly TinyDay[]
  readonly slots?: readonly TinySlot[]
  readonly rules?: Partial<PlanningRulesV3>
  /** Per-employee, per-day window overrides, keyed `"employeeId|dayIndex"`. */
  readonly windows?: Readonly<Record<string, { earliest?: number; latest?: number }>>
  /** Employee ids unavailable on a given day, keyed `"employeeId|dayIndex"`. */
  readonly unavailable?: readonly string[]
}

export function tinyProblem(spec: TinySpec): PlanningProblemV3 {
  const days: PlanningDayV3[] = spec.days.map((day, index) => ({
    date: TINY_DATES[index] as IsoDate,
    weekDay: WEEK_DAY_BY_INDEX[index],
    weekKey: "2026-W30",
    closed: day.closed ?? false,
    opensAtMinutes: day.closed === true ? null : (day.opensAtMinutes ?? 360),
    closesAtMinutes: day.closed === true ? null : (day.closesAtMinutes ?? 1_200),
    budgetMinutes: day.budgetMinutes,
  }))

  const employees: PlanningEmployeeV3[] = spec.employees.map((employee) => ({
    id: employee.id as unknown as EmployeeId,
    firstName: employee.id,
    lastName: "",
    contractMinutes: employee.contractMinutes,
    workingDays: WEEK_DAY_BY_INDEX.slice(0, spec.days.length),
    fixedRestDays: [],
    minimumDailyMinutes: employee.minimumDailyMinutes ?? 0,
    maximumDailyMinutes: employee.maximumDailyMinutes ?? 600,
    canOpen: employee.canOpen ?? true,
    canClose: employee.canClose ?? true,
    canSplitShift: employee.canSplitShift ?? false,
    maximumOpenings: employee.maximumOpenings ?? null,
    maximumClosings: employee.maximumClosings ?? null,
    prefersOpening: false,
    prefersClosing: false,
  }))

  const unavailable = new Set(spec.unavailable ?? [])
  const employeeDays: PlanningEmployeeDayV3[] = employees.flatMap((employee, employeeIndex) =>
    days.map((day, dayIndex) => {
      const key = `${spec.employees[employeeIndex].id}|${dayIndex}`
      const override = spec.windows?.[key] ?? {}
      const available = !day.closed && !unavailable.has(key)
      const earliest = Math.max(day.opensAtMinutes ?? 0, override.earliest ?? 0)
      const latest = Math.min(day.closesAtMinutes ?? 0, override.latest ?? 1_440)
      return {
        employeeId: employee.id,
        date: day.date,
        available,
        mandatory: false,
        fixedRest: false,
        earliestStartMinutes: earliest,
        latestEndMinutes: latest,
        maximumMinutes: available ? Math.min(employee.maximumDailyMinutes, latest - earliest) : 0,
        ...(available ? {} : { unavailableReason: "absence" }),
      }
    })
  )

  const demandSlots: PlanningDemandSlotV3[] = (spec.slots ?? []).flatMap((slot) => {
    const targets =
      slot.dayIndex !== undefined
        ? [slot.dayIndex]
        : days.map((_day, index) => index).filter((index) => !days[index].closed)
    return targets.map((dayIndex) => ({
      id: `slot_${dayIndex}_${slot.startMinutes}_${slot.endMinutes}`,
      date: days[dayIndex].date,
      startMinutes: slot.startMinutes,
      endMinutes: slot.endMinutes,
      requiredEmployees: slot.requiredEmployees,
      ...(slot.hardMinimumEmployees !== undefined
        ? { hardMinimumEmployees: slot.hardMinimumEmployees }
        : {}),
      maximumEmployees: null,
    }))
  })

  return {
    version: PLANNING_PROBLEM_V3_VERSION,
    planningId: "tiny" as unknown as PlanningId,
    sectorId: "tiny",
    period: { start: days[0].date, end: days[days.length - 1].date },
    timeStepMinutes: 15,
    employees,
    days,
    employeeDays,
    demandSlots,
    rules: {
      minimumShiftMinutes: 240,
      maximumShiftMinutes: 600,
      minimumRestMinutes: 720,
      maximumConsecutiveWorkedDays: null,
      maximumConsecutiveWorkedDaysSource: "derived-fallback",
      splitShiftAllowed: false,
      maximumSplitMinutes: null,
      minimumOpeningsPerDay: 0,
      exactClosingsPerDay: 0,
      ...spec.rules,
    },
    objectives: ["coverage-deficit"],
  }
}

/** Total worked minutes for one employee across a solution. */
export function minutesOf(
  solution: { readonly assignments: readonly { employeeId: EmployeeId; segments: readonly { startMinutes: number; endMinutes: number }[] }[] },
  employeeId: string
): number {
  return solution.assignments
    .filter((assignment) => String(assignment.employeeId) === employeeId)
    .reduce(
      (sum, assignment) =>
        sum +
        assignment.segments.reduce(
          (inner, segment) => inner + (segment.endMinutes - segment.startMinutes),
          0
        ),
      0
    )
}
