import { describe, expect, it } from "vitest"

import { WEEK_DAYS } from "@/features/core/models"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

import { runPlanningFlow } from "@/features/planning/flow"
import { toEmployeePlanningRows } from "@/features/planning/view/employee-planning-view-model"

const NOW = "2026-07-01T00:00:00.000Z"
const WEEKEND = new Set(["saturday", "sunday"])

/** A valid onboarding store config: weekdays 09:00–17:00, weekend closed. */
function storeConfig(overrides: Partial<StoreConfig> = {}): StoreConfig {
  return {
    name: "Test Store",
    address: "1 rue de Test",
    city: "Paris",
    postalCode: "75001",
    country: "France",
    timezone: "Europe/Paris",
    openingHours: WEEK_DAYS.map((day) =>
      WEEKEND.has(day)
        ? { day, closed: true, opensAt: "", closesAt: "" }
        : { day, closed: false, opensAt: "09:00", closesAt: "17:00" }
    ),
    planningMode: "dynamic",
    minShiftDuration: 120,
    maxShiftDuration: 600,
    timeGranularity: 60,
    splitShiftPolicy: "forbidden",
    minSplitDuration: undefined,
    maxSplitDuration: undefined,
    maxSplitShiftsPerWeek: undefined,
    minDailyHours: 2,
    maxDailyHours: 10,
    minRestBetweenShifts: 11,
    maxWeeklyHoursOverride: undefined,
    ...overrides,
  } as StoreConfig
}

function employee(id: string, overrides: Partial<EmployeeRecord> = {}): EmployeeRecord {
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
    canClose: true,
    splitShiftAllowed: false,
    fixedDaysOff: [],
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

// Mon 2026-07-06 … Sun 2026-07-12 → 5 open weekdays.
const SCOPE = {
  planningId: "planning_1",
  period: { start: "2026-07-06", end: "2026-07-12" },
  now: NOW,
}

describe("runPlanningFlow", () => {
  it("generates a planning successfully end-to-end", () => {
    const result = runPlanningFlow({
      store: storeConfig(),
      employees: [employee("e1"), employee("e2")],
      scope: SCOPE,
    })

    expect(result.status).toBe("success")
    if (result.status !== "success") return

    // Every engine produced a report.
    expect(typeof result.generation.score.overall).toBe("number")
    expect(result.generation.constraintReport.feasible).toBe(true)
    expect(result.generation.assignments.length).toBeGreaterThanOrEqual(5) // coverage plus contract completion
    expect(result.generation.coverage.statistics.covered).toBe(5)
    expect(result.statistics.employees).toHaveLength(2)

    // Grouped-by-employee display rows.
    const rows = toEmployeePlanningRows(result)
    expect(rows).toHaveLength(2)
    const first = rows.find((r) => r.employeeId === ("e1" as never))!
    expect(first.shifts.length).toBeGreaterThan(0)
    expect(first.name).toBe("e1 Test")
  })

  it("returns structured errors for a missing (invalid) employee", () => {
    const result = runPlanningFlow({
      store: storeConfig(),
      employees: [employee("e1", { firstName: "" })],
      scope: SCOPE,
    })

    expect(result.status).toBe("error")
    if (result.status !== "error") return
    expect(result.errors.some((e) => e.code === "missing_required")).toBe(true)
  })

  it("handles impossible demand without crashing (coverage gaps, still succeeds)", () => {
    const result = runPlanningFlow({
      store: storeConfig(),
      employees: [], // no one to staff the open days
      scope: SCOPE,
    })

    expect(result.status).toBe("success")
    if (result.status !== "success") return
    expect(result.generation.coverage.statistics.underCovered).toBeGreaterThan(0)
    expect(result.generation.assignments).toHaveLength(0)
  })

  it("returns structured errors for an invalid configuration", () => {
    const result = runPlanningFlow({
      store: storeConfig({ name: "" }), // store name is required
      employees: [employee("e1")],
      scope: SCOPE,
    })

    expect(result.status).toBe("error")
    if (result.status !== "error") return
    expect(result.errors.some((e) => e.path.includes("name"))).toBe(true)
  })

  it("bloque une durée legacy 36.5 ambiguë jusqu’à confirmation explicite", () => {
    const result = runPlanningFlow({ store: storeConfig(), employees: [employee("legacy", { schemaVersion: 1, weeklyHours: 36.5, weeklyMinutes: null, contractMinuteConfirmationRequired: true })], scope: SCOPE })
    expect(result.status).toBe("error")
    if (result.status !== "error") return
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "legacy_contract_confirmation_required", path: "employees.legacy.weeklyMinutes" }))
  })
})
