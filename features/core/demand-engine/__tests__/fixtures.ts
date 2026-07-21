import type { CapabilityKey, Employee, EmployeeId } from "@/features/core/models"

import type {
  CoverageRequirement,
  CoverageWindow,
  Demand,
} from "@/features/core/demand-engine/models"
import type { DemandPriority } from "@/features/core/demand-engine/types"

// Reuse the employee-engine calculator fixtures — no duplicated builders.
import {
  EMP,
  OTHER_EMP,
  STORE_ID,
  assignment,
  brand,
  segment,
  shift,
} from "@/features/core/employee-engine/calculators/__tests__/fixtures"

export { EMP, OTHER_EMP, assignment, segment, shift }

const TS = "2026-01-01T00:00:00.000Z"

export function employee(
  id: EmployeeId = EMP,
  capabilities: CapabilityKey[] = []
): Employee {
  return {
    id,
    storeId: STORE_ID,
    contractId: null,
    firstName: "Test",
    lastName: "User",
    phone: "",
    email: "",
    status: "active",
    capabilities,
    createdAt: TS,
    updatedAt: TS,
  }
}

export function coverageWindow(
  date: string,
  start: string,
  end: string,
  endDayOffset?: number
): CoverageWindow {
  return endDayOffset === undefined
    ? { date, start, end }
    : { date, start, end, endDayOffset }
}

export function requirement(
  id: string,
  window: CoverageWindow,
  opts: {
    min: number
    max?: number | null
    capabilities?: CapabilityKey[]
    priority?: DemandPriority
  }
): CoverageRequirement {
  return {
    id: brand("req_" + id),
    window,
    minEmployees: opts.min,
    maxEmployees: opts.max ?? null,
    requiredCapabilities: opts.capabilities,
    priority: opts.priority ?? "medium",
  }
}

export function demand(requirements: CoverageRequirement[]): Demand {
  return { id: brand("demand_1"), requirements }
}
