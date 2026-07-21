import type {
  Contract,
  Employee,
  Store,
  StoreId,
  WeekDay,
} from "@/features/core/models"
import { WEEK_DAYS } from "@/features/core/models"

import type {
  CoverageRequirement,
  CoverageRequirementId,
  Demand,
  DemandId,
} from "@/features/core/demand-engine"
import type { ContractId, EmployeeId } from "@/features/core/models"
import {
  createConstraintRegistry,
  registerBuiltInConstraints,
  type ConstraintRegistry,
} from "@/features/core/constraint-engine"
import type { GenerationSettings } from "@/features/core/planning-generator"
import type { PlanningId } from "@/features/core/models"

export function brand<T>(value: string): T {
  return value as unknown as T
}

const NOW = "2026-07-01T00:00:00.000Z"
export const STORE_ID = brand<StoreId>("store_1")

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
    planningSettings: {
      mode: "dynamic",
      granularity: 60,
      minShiftDuration: 120,
      maxShiftDuration: 600,
    },
    splitShiftPolicy: {
      kind: "forbidden",
      minSplitDuration: null,
      maxSplitDuration: null,
      maxSplitShiftsPerWeek: null,
    },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function employee(id: string): Employee {
  return {
    id: brand<EmployeeId>(id),
    storeId: STORE_ID,
    contractId: brand<ContractId>(`contract_${id}`),
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

/** A full-time contract; `workingDays` defaults to the whole week (always available). */
export function contract(
  employeeId: string,
  workingDays: readonly WeekDay[] = WEEK_DAYS
): Contract {
  return {
    id: brand<ContractId>(`contract_${employeeId}`),
    employeeId: brand<EmployeeId>(employeeId),
    contractType: "full_time",
    weeklyHours: 35,
    workingDays: [...workingDays],
    minDailyHours: 2,
    maxDailyHours: 10,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function requirement(
  id: string,
  date: string,
  min: number,
  max?: number | null
): CoverageRequirement {
  return {
    id: brand<CoverageRequirementId>(id),
    priority: "high",
    window: { date, start: "09:00", end: "17:00" },
    minEmployees: min,
    maxEmployees: max ?? null,
  }
}

export function demand(requirements: readonly CoverageRequirement[]): Demand {
  return {
    id: brand<DemandId>("demand_1"),
    storeId: STORE_ID,
    requirements,
  }
}

export function settings(): GenerationSettings {
  return {
    planningId: brand<PlanningId>("planning_1"),
    // 2026-07-06 is a Monday; the week runs Mon 07-06 … Sun 07-12.
    period: { start: "2026-07-06", end: "2026-07-12" },
    now: NOW,
    mode: "dynamic",
  }
}

/** A registry loaded with the built-in constraints (coverage, availability, contract-hours). */
export function builtInRegistry(): ConstraintRegistry {
  const registry = createConstraintRegistry()
  registerBuiltInConstraints(registry)
  return registry
}
