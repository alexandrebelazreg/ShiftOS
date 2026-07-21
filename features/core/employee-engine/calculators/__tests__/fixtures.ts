import type {
  Absence,
  AbsenceType,
  Assignment,
  AvailabilityEffect,
  AvailabilityRule,
  Constraint,
  Contract,
  DaySchedule,
  EmployeeId,
  Holiday,
  IsoDate,
  Shift,
  ShiftSegment,
  StoreId,
  Store,
  TimeString,
  TimeWindow,
  WeekDay,
} from "@/features/core/models"
import { WEEK_DAYS } from "@/features/core/models"

/**
 * Deterministic test fixtures. Builders construct valid core entities with
 * sensible defaults so each test states only the fields it cares about. No mock
 * frameworks — plain data.
 */

const TS = "2026-01-01T00:00:00.000Z"

/** Cast a plain string to a branded id (test-only). */
export function brand<T>(value: string): T {
  return value as unknown as T
}

export const EMP = brand<EmployeeId>("emp_1")
export const OTHER_EMP = brand<EmployeeId>("emp_2")
export const STORE_ID = brand<StoreId>("store_1")

export function segment(
  start: TimeString,
  end: TimeString,
  endDayOffset?: number
): ShiftSegment {
  return endDayOffset === undefined
    ? { startTime: start, endTime: end }
    : { startTime: start, endTime: end, endDayOffset }
}

export function shift(
  id: string,
  date: IsoDate,
  segments: readonly ShiftSegment[]
): Shift {
  return {
    id: brand("shift_" + id),
    storeId: STORE_ID,
    templateId: null,
    date,
    source: "dynamic",
    segments: [...segments],
    createdAt: TS,
    updatedAt: TS,
  }
}

export function assignment(
  shiftId: Shift["id"],
  employeeId: EmployeeId = EMP
): Assignment {
  return {
    id: brand("assign_" + String(shiftId)),
    planningId: brand("planning_1"),
    shiftId,
    employeeId,
    status: "confirmed",
    createdAt: TS,
    updatedAt: TS,
  }
}

export function contract(workingDays: readonly WeekDay[]): Contract {
  return {
    id: brand("contract_1"),
    employeeId: EMP,
    contractType: "full_time",
    weeklyHours: 35,
    workingDays: [...workingDays],
    minDailyHours: 4,
    maxDailyHours: 10,
    createdAt: TS,
    updatedAt: TS,
  }
}

export const ALL_DAYS: readonly WeekDay[] = WEEK_DAYS

export function daySchedule(
  day: WeekDay,
  opens: TimeString | null,
  closes: TimeString | null
): DaySchedule {
  const closed = opens === null || closes === null
  return { day, closed, opensAt: opens, closesAt: closes }
}

/**
 * Store whose opening hours default to 09:00–18:00 every day; pass a partial
 * map to override or close specific days.
 */
export function store(
  hours: Partial<Record<WeekDay, DaySchedule>> = {}
): Store {
  const openingHours: DaySchedule[] = WEEK_DAYS.map(
    (day) => hours[day] ?? daySchedule(day, "09:00", "18:00")
  )
  return {
    id: STORE_ID,
    organizationId: brand("org_1"),
    name: "Test workplace",
    address: "1 Test Street",
    city: "Testville",
    postalCode: "00000",
    country: "Testland",
    timezone: "Europe/Paris",
    openingHours,
    planningSettings: {
      mode: "shift_library",
      granularity: null,
      minShiftDuration: null,
      maxShiftDuration: null,
    },
    splitShiftPolicy: {
      kind: "forbidden",
      minSplitDuration: null,
      maxSplitDuration: null,
      maxSplitShiftsPerWeek: null,
    },
    createdAt: TS,
    updatedAt: TS,
  }
}

export function dayConstraint(
  day: WeekDay,
  type: "FIXED_DAY_OFF" | "FORBIDDEN_DAY",
  employeeId: EmployeeId = EMP
): Constraint {
  return { id: brand("cst_" + day + "_" + type), employeeId, type, day }
}

export function holiday(date: IsoDate, name = "Holiday"): Holiday {
  return {
    id: brand("hol_" + date),
    storeId: STORE_ID,
    date,
    name,
    createdAt: TS,
    updatedAt: TS,
  }
}

export function absence(
  type: AbsenceType,
  start: IsoDate,
  end: IsoDate,
  employeeId: EmployeeId = EMP
): Absence {
  return {
    id: brand("abs_" + start),
    employeeId,
    type,
    range: { start, end },
    createdAt: TS,
    updatedAt: TS,
  }
}

export function recurringRule(
  weekDay: WeekDay,
  effect: AvailabilityEffect,
  employeeId: EmployeeId = EMP
): AvailabilityRule {
  return {
    id: brand("rule_rec_" + weekDay + "_" + effect),
    employeeId,
    effect,
    kind: "recurring",
    weekDay,
    createdAt: TS,
    updatedAt: TS,
  }
}

export function dateRule(
  date: IsoDate,
  effect: AvailabilityEffect,
  window: TimeWindow | null = null,
  employeeId: EmployeeId = EMP
): AvailabilityRule {
  return {
    id: brand("rule_date_" + date + "_" + effect),
    employeeId,
    effect,
    kind: "date",
    date,
    window,
    createdAt: TS,
    updatedAt: TS,
  }
}
