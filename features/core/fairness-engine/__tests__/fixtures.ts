import type {
  Assignment,
  DateRange,
  Employee,
  EmployeeId,
  Planning,
  PlanningId,
  StoreId,
} from "@/features/core/models"

import type { EmployeeStatistics } from "@/features/core/statistics-engine"

/** Cast a raw string to a branded id (test boundary only). */
export function brand<T>(value: string): T {
  return value as unknown as T
}

export const PERIOD: DateRange = { start: "2026-07-01", end: "2026-07-31" }
const NOW = "2026-07-01T00:00:00.000Z"

/** An active employee with the given id (other fields are irrelevant here). */
export function employee(id: string, status: Employee["status"] = "active"): Employee {
  return {
    id: brand<EmployeeId>(id),
    storeId: brand<StoreId>("store_1"),
    contractId: null,
    firstName: id,
    lastName: id,
    phone: "",
    email: `${id}@example.test`,
    status,
    capabilities: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** Per-employee statistics; every metric defaults to 0 so tests set only what they exercise. */
export function statistics(
  id: string,
  metrics: Partial<Omit<EmployeeStatistics, "employeeId" | "period">> = {}
): EmployeeStatistics {
  return {
    employeeId: brand<EmployeeId>(id),
    period: PERIOD,
    workedMinutes: 0,
    workedHours: 0,
    workedDays: 0,
    assignmentCount: 0,
    openingCount: 0,
    closingCount: 0,
    splitShiftCount: 0,
    weekendCount: 0,
    saturdayCount: 0,
    sundayCount: 0,
    nightShiftCount: 0,
    holidayCount: 0,
    absenceCount: 0,
    coverageContribution: 0,
    ...metrics,
  }
}

export function planning(): Planning {
  return {
    id: brand<PlanningId>("planning_1"),
    storeId: brand<StoreId>("store_1"),
    status: "draft",
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    generatedWith: "dynamic",
    createdAt: NOW,
    updatedAt: NOW,
  }
}

/** Assignments are context only for the shipped dimensions; an empty list is fine. */
export const NO_ASSIGNMENTS: readonly Assignment[] = []
