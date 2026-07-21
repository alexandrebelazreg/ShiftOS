import { describe, expect, it } from "vitest"

import {
  type Constraint,
  type ConstraintEvaluationReport,
  constraintEvaluator,
  coverageConstraint,
  createConstraintRegistry,
  registerBuiltInConstraints,
} from "@/features/core/constraint-engine"

import {
  ALL_DAYS,
  absence,
  assignment,
  contract,
  dailyShift,
  employee,
  makeContext,
} from "@/features/core/constraint-engine/__tests__/fixtures"
import type { ConstraintContext } from "@/features/core/constraint-engine/models"

function evaluate(over: Partial<ConstraintContext> = {}): ConstraintEvaluationReport {
  const registry = createConstraintRegistry()
  registerBuiltInConstraints(registry)
  return constraintEvaluator.evaluate(registry, makeContext(over))
}

function outcomeOf(report: ConstraintEvaluationReport, id: string) {
  return report.constraints.find((c) => c.constraintId === id)?.outcome
}

describe("constraintEvaluator", () => {
  it("produces a well-formed report with timing and every constraint", () => {
    const report = evaluate({
      employees: [employee()],
      contracts: [contract(ALL_DAYS)],
    })
    expect(report.constraints).toHaveLength(3)
    expect(typeof report.executionTimeMs).toBe("number")
    expect(report.executionTimeMs).toBeGreaterThanOrEqual(0)
    expect(typeof report.evaluatedAt).toBe("string")
    expect(report.score.total).toBe(3)
  })

  it("reports all constraints passing on a valid planning", () => {
    const shifts = [
      dailyShift("s1", "2026-07-06"),
      dailyShift("s2", "2026-07-07"),
      dailyShift("s3", "2026-07-08"),
      dailyShift("s4", "2026-07-09"),
    ] // 4 × 8h = 32h ≤ 35h contract
    const assignments = shifts.map((s) => assignment(s.id))

    const report = evaluate({
      employees: [employee()],
      contracts: [contract(ALL_DAYS)],
      shifts,
      assignments,
    })

    expect(report.feasible).toBe(true)
    expect(report.score.passed).toBe(3)
    expect(report.score.failed).toBe(0)
    expect(report.score.warnings).toBe(0)
    expect(report.hardViolations).toEqual([])
    expect(report.constraints.every((c) => c.outcome === "pass")).toBe(true)
  })

  it("reports one hard failure (coverage) without affecting the others", () => {
    const shifts = [dailyShift("s1", "2026-07-06"), dailyShift("s2", "2026-07-07")]
    const assignments = [assignment(shifts[0].id)] // s2 uncovered

    const report = evaluate({
      employees: [employee()],
      contracts: [contract(ALL_DAYS)],
      shifts,
      assignments,
    })

    expect(report.feasible).toBe(false)
    expect(report.score.failed).toBe(1)
    expect(outcomeOf(report, "coverage.shift_coverage")).toBe("fail")
    expect(outcomeOf(report, "availability.employee_availability")).toBe("pass")
    expect(outcomeOf(report, "workload.contract_hours")).toBe("pass")
    expect(report.hardViolations.length).toBeGreaterThanOrEqual(1)
    expect(report.passed).toHaveLength(2)
  })

  it("aggregates multiple failures (coverage + availability hard, contract soft)", () => {
    const worked = ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"].map(
      (date, i) => dailyShift("w" + i, date)
    ) // 6 × 8h = 48h > 35h → soft warning
    const uncovered = dailyShift("u", "2026-07-12") // unassigned → coverage fail
    const shifts = [...worked, uncovered]
    const assignments = worked.map((s) => assignment(s.id))
    // EMP is absent on 2026-07-08 but assigned that day → availability fail
    const absences = [absence("sick_leave", "2026-07-08", "2026-07-08")]

    const report = evaluate({
      employees: [employee()],
      contracts: [contract(ALL_DAYS)],
      shifts,
      assignments,
      absences,
    })

    expect(report.feasible).toBe(false)
    expect(report.score.failed).toBe(2) // coverage + availability
    expect(report.score.warnings).toBe(1) // contract hours
    expect(report.hardViolations.length).toBeGreaterThanOrEqual(2)
    expect(report.softViolations.length).toBeGreaterThanOrEqual(1)
  })

  it("handles no employees: coverage fails, availability & contract pass, no crash", () => {
    const shifts = [dailyShift("s1", "2026-07-06")]
    const report = evaluate({ employees: [], contracts: [], shifts, assignments: [] })

    expect(report.constraints).toHaveLength(3)
    expect(outcomeOf(report, "coverage.shift_coverage")).toBe("fail")
    expect(outcomeOf(report, "availability.employee_availability")).toBe("pass")
    expect(outcomeOf(report, "workload.contract_hours")).toBe("pass")
  })

  it("handles an empty planning: every constraint passes", () => {
    const report = evaluate({
      employees: [employee()],
      contracts: [contract(ALL_DAYS)],
      shifts: [],
      assignments: [],
    })
    expect(report.feasible).toBe(true)
    expect(report.score.passed).toBe(3)
    expect(report.score.failed).toBe(0)
    expect(report.hardViolations).toEqual([])
  })

  it("isolates a throwing constraint — the others still evaluate", () => {
    const boom: Constraint = {
      id: "test.boom",
      category: "legal",
      type: "hard",
      priority: "low",
      enabled: true,
      metadata: { label: "Boom", description: "always throws" },
      evaluate() {
        throw new Error("kaboom")
      },
    }

    const registry = createConstraintRegistry()
    registerBuiltInConstraints(registry)
    registry.register(boom)

    const report = constraintEvaluator.evaluate(
      registry,
      makeContext({ employees: [employee()], contracts: [contract(ALL_DAYS)] })
    )

    expect(report.constraints).toHaveLength(4)
    const evaluatedBoom = report.constraints.find((c) => c.constraintId === "test.boom")
    expect(evaluatedBoom?.errored).toBe(true)
    expect(evaluatedBoom?.outcome).toBe("fail")
    // The three built-ins were still evaluated (empty planning → pass).
    expect(report.constraints.filter((c) => c.outcome === "pass")).toHaveLength(3)
  })

  it("registry supports toggling and rejects duplicate ids", () => {
    const registry = createConstraintRegistry()
    registerBuiltInConstraints(registry)
    expect(registry.enabled()).toHaveLength(3)

    registry.setEnabled("workload.contract_hours", false)
    expect(registry.enabled()).toHaveLength(2)

    expect(() => registry.register(coverageConstraint())).toThrow()
  })
})
