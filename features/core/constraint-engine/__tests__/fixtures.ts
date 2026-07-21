import type { Employee, EmployeeId, Planning, PlanningId } from "@/features/core/models"

import type { ConstraintContext } from "@/features/core/constraint-engine/models"

// Reuse the employee-engine calculator fixtures — no duplicated builders.
import {
  ALL_DAYS,
  EMP,
  STORE_ID,
  absence,
  assignment,
  brand,
  contract,
  segment,
  shift,
  store,
} from "@/features/core/employee-engine/calculators/__tests__/fixtures"

export {
  ALL_DAYS,
  EMP,
  absence,
  assignment,
  contract,
  segment,
  shift,
  store,
}

const TS = "2026-01-01T00:00:00.000Z"

/** Monday 2026-07-06 → Sunday 2026-07-12 (a single ISO week, W28). */
export const PERIOD = { start: "2026-07-06", end: "2026-07-12" }
export const PLANNING_ID = brand<PlanningId>("planning_1")

export function employee(id: EmployeeId = EMP): Employee {
  return {
    id,
    storeId: STORE_ID,
    contractId: brand("contract_1"),
    firstName: "Test",
    lastName: "User",
    phone: "",
    email: "",
    status: "active",
    capabilities: [],
    createdAt: TS,
    updatedAt: TS,
  }
}

export function planning(): Planning {
  return {
    id: PLANNING_ID,
    storeId: STORE_ID,
    status: "draft",
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    generatedWith: "shift_library",
    createdAt: TS,
    updatedAt: TS,
  }
}

/** A shift on `date` with a single 09:00–17:00 (8h) segment by default. */
export function dailyShift(
  id: string,
  date: string,
  window: [string, string] = ["09:00", "17:00"]
) {
  return shift(id, date, [segment(window[0], window[1])])
}

export function makeContext(
  over: Partial<ConstraintContext> = {}
): ConstraintContext {
  return {
    now: TS,
    period: PERIOD,
    store: store(),
    planning: planning(),
    employees: [],
    contracts: [],
    shifts: [],
    assignments: [],
    availabilityRules: [],
    absences: [],
    holidays: [],
    employeeConstraints: [],
    ...over,
  }
}
