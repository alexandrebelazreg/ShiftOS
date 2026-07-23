import { describe, expect, it } from "vitest"

import { runPlanningFlow } from "@/features/planning/flow"
import { toEmployeePlanningRows } from "@/features/planning/view/employee-planning-view-model"
import {
  employee,
  FIXTURE_SCOPE as SCOPE,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"

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
