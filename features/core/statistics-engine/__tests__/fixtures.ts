import type {
  Absence,
  Assignment,
  Employee,
  Holiday,
  Planning,
  Shift,
  ShiftSegment,
  Store,
} from "@/features/core/models"
import { WEEK_DAYS } from "@/features/core/models"
import type {
  AbsenceId,
  AssignmentId,
  EmployeeId,
  HolidayId,
  PlanningId,
  ShiftId,
  StoreId,
} from "@/features/core/models"

export function brand<T>(value: string): T {
  return value as unknown as T
}

const NOW = "2026-07-01T00:00:00.000Z"
export const STORE_ID = brand<StoreId>("store_1")
// 2026-07-06 is a Monday; the week runs Mon 07-06 … Sun 07-12.
export const PERIOD = { start: "2026-07-06", end: "2026-07-12" }

/** A store open every day 08:00–20:00. */
export function store(): Store {
  return {
    id: STORE_ID,
    organizationId: brand("org_1"),
    name: "Test Store",
    address: "",
    city: "",
    postalCode: "",
    country: "FR",
    timezone: "Europe/Paris",
    openingHours: WEEK_DAYS.map((day) => ({
      day,
      closed: false,
      opensAt: "08:00",
      closesAt: "20:00",
    })),
    planningSettings: { mode: "dynamic", granularity: 60, minShiftDuration: 120, maxShiftDuration: 600 },
    splitShiftPolicy: { kind: "allowed", minSplitDuration: 60, maxSplitDuration: 240, maxSplitShiftsPerWeek: 3 },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function employee(id: string): Employee {
  return {
    id: brand<EmployeeId>(id),
    storeId: STORE_ID,
    contractId: null,
    firstName: id,
    lastName: id,
    phone: "",
    email: `${id}@example.test`,
    status: "active",
    capabilities: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function planning(): Planning {
  return {
    id: brand<PlanningId>("planning_1"),
    storeId: STORE_ID,
    status: "draft",
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    generatedWith: "dynamic",
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** A shift on `date` with the given segments (defaults to a single 09:00–17:00 segment). */
export function shift(
  id: string,
  date: string,
  segments: ShiftSegment[] = [{ startTime: "09:00", endTime: "17:00" }]
): Shift {
  return {
    id: brand<ShiftId>(id),
    storeId: STORE_ID,
    templateId: null,
    date,
    source: "dynamic",
    segments,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function assignment(id: string, employeeId: string, shiftId: string): Assignment {
  return {
    id: brand<AssignmentId>(id),
    planningId: brand<PlanningId>("planning_1"),
    shiftId: brand<ShiftId>(shiftId),
    employeeId: brand<EmployeeId>(employeeId),
    status: "proposed",
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function holiday(id: string, date: string): Holiday {
  return {
    id: brand<HolidayId>(id),
    storeId: STORE_ID,
    date,
    name: `Holiday ${date}`,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function absence(id: string, employeeId: string, start: string, end: string): Absence {
  return {
    id: brand<AbsenceId>(id),
    employeeId: brand<EmployeeId>(employeeId),
    type: "paid_leave",
    range: { start, end },
    createdAt: NOW,
    updatedAt: NOW,
  }
}
