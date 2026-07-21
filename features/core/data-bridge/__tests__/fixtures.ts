import { WEEK_DAYS, type OrganizationId, type StoreId } from "@/features/core/models"

import { createStoreConfiguration } from "@/features/store"
import type { StoreConfiguration } from "@/features/store"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

import type {
  BridgeInput,
  DemandInput,
  StoreInput,
} from "@/features/core/data-bridge"

export function brand<T>(value: string): T {
  return value as unknown as T
}

const NOW = "2026-07-01T00:00:00.000Z"

/** A valid store configuration with a name and a capability catalogue. */
export function storeConfiguration(
  overrides: Partial<StoreConfiguration> = {}
): StoreConfiguration {
  return createStoreConfiguration({
    general: {
      name: "Test Store",
      timezone: "Europe/Paris",
      country: "France",
      currency: "EUR",
      weekStart: "monday",
    },
    capabilities: {
      definitions: [{ key: "CAN_OPEN", label: "Can open" }],
    },
    openingHours: WEEK_DAYS.map((day) => day === "sunday" ? { day, closed: true, ranges: [] } : { day, closed: false, ranges: [{ start: "09:00", end: "17:00" }] }),
    ...overrides,
  })
}

export function storeInput(configuration = storeConfiguration()): StoreInput {
  return {
    storeId: brand<StoreId>("store_1"),
    organizationId: brand<OrganizationId>("org_1"),
    configuration,
    address: "1 rue de Test",
    city: "Paris",
    postalCode: "75001",
  }
}

export function employeeRecord(
  id: string,
  overrides: Partial<EmployeeRecord> = {}
): EmployeeRecord {
  return {
    id,
    firstName: id,
    lastName: "Test",
    phone: "",
    email: `${id}@example.test`,
    status: "active",
    weeklyHours: 35,
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    contractType: "full_time",
    canOpen: true,
    canClose: false,
    splitShiftAllowed: false,
    fixedDaysOff: ["sunday"],
    forbiddenDays: [],
    maxOpenings: null,
    maxClosings: null,
    preferOpening: false,
    preferClosing: false,
    notes: "",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function demandInput(): DemandInput {
  return {
    id: "demand_1",
    requirements: [
      {
        id: "r1",
        date: "2026-07-06",
        start: "09:00",
        end: "17:00",
        minEmployees: 1,
        requiredCapabilities: ["CAN_OPEN"],
      },
    ],
  }
}

export function bridgeInput(overrides: Partial<BridgeInput> = {}): BridgeInput {
  return {
    store: storeInput(),
    employees: [employeeRecord("e1")],
    demand: demandInput(),
    scope: {
      planningId: "planning_1",
      period: { start: "2026-07-06", end: "2026-07-12" },
      now: NOW,
    },
    ...overrides,
  }
}
