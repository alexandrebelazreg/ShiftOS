import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"

import type {
  FairnessDimensionCalculator,
  FairnessPolicy,
} from "@/features/core/fairness-engine"
import {
  DEFAULT_FAIRNESS_POLICY,
  createDefaultFairnessRegistry,
  fairnessEngine,
} from "@/features/core/fairness-engine"

import {
  NO_ASSIGNMENTS,
  brand,
  employee,
  planning,
  statistics,
} from "@/features/core/fairness-engine/__tests__/fixtures"

function inputWith(
  employees: readonly ReturnType<typeof employee>[],
  stats: readonly ReturnType<typeof statistics>[]
) {
  return {
    planning: planning(),
    employees,
    assignments: NO_ASSIGNMENTS,
    statistics: stats,
  }
}

const THREE = [employee("e1"), employee("e2"), employee("e3")]

describe("fairnessEngine.analyze", () => {
  it("scores a perfectly balanced planning at the top", () => {
    const stats = ["e1", "e2", "e3"].map((id) =>
      statistics(id, {
        workedMinutes: 2400,
        openingCount: 2,
        closingCount: 2,
        splitShiftCount: 1,
        weekendCount: 2,
      })
    )

    const report = fairnessEngine.analyze(inputWith(THREE, stats))

    expect(report.overall).toBe(1)
    expect(report.dimensions).toHaveLength(5)
    for (const dim of report.dimensions) {
      expect(dim.fairness).toBe(1)
      expect(dim.gini).toBe(0)
    }
    expect(report.warnings).toEqual([])
    expect(report.imbalances).toEqual([])
    expect(report.details.cohortSize).toBe(3)
  })

  it("detects a single overloaded employee on worked hours", () => {
    const stats = [
      statistics("e1", { workedMinutes: 6000 }),
      statistics("e2", { workedMinutes: 1200 }),
      statistics("e3", { workedMinutes: 1200 }),
    ]

    const report = fairnessEngine.analyze(inputWith(THREE, stats))

    const worked = report.dimensions.find((d) => d.dimension === "worked_hours")!
    expect(worked.fairness).toBeCloseTo(0.619, 3)
    expect(worked.fairness).toBeLessThan(1)
    expect(report.overall).toBeLessThan(1)

    // e1 flagged as over; the sorted distribution puts them first.
    const over = report.imbalances.find((i) => i.direction === "over")!
    expect(over.dimension).toBe("worked_hours")
    expect(over.employeeId).toBe(brand<EmployeeId>("e1"))
    expect(worked.distribution[0].employeeId).toBe(brand<EmployeeId>("e1"))

    expect(report.warnings.some((w) => w.dimension === "worked_hours")).toBe(true)
  })

  it("detects a weekend imbalance", () => {
    const stats = [
      statistics("e1", { weekendCount: 8 }),
      statistics("e2", { weekendCount: 0 }),
      statistics("e3", { weekendCount: 0 }),
    ]

    const report = fairnessEngine.analyze(inputWith(THREE, stats))

    const weekend = report.dimensions.find((d) => d.dimension === "weekend")!
    expect(weekend.fairness).toBeCloseTo(0.3333, 3)
    expect(report.imbalances.some((i) => i.dimension === "weekend" && i.direction === "over")).toBe(
      true
    )
    const warning = report.warnings.find((w) => w.dimension === "weekend")!
    expect(warning.severity).toBe("major") // fairness < 0.5

    // Other dimensions stay perfectly fair (independence of dimensions).
    expect(report.dimensions.find((d) => d.dimension === "opening")!.fairness).toBe(1)
  })

  it("detects an opening imbalance", () => {
    const stats = [
      statistics("e1", { openingCount: 6 }),
      statistics("e2", { openingCount: 0 }),
      statistics("e3", { openingCount: 0 }),
    ]

    const report = fairnessEngine.analyze(inputWith(THREE, stats))

    const opening = report.dimensions.find((d) => d.dimension === "opening")!
    expect(opening.fairness).toBeLessThan(0.75)
    expect(report.imbalances.some((i) => i.dimension === "opening")).toBe(true)
    expect(report.dimensions.find((d) => d.dimension === "closing")!.fairness).toBe(1)
  })

  it("detects a closing imbalance", () => {
    const stats = [
      statistics("e1", { closingCount: 6 }),
      statistics("e2", { closingCount: 0 }),
      statistics("e3", { closingCount: 0 }),
    ]

    const report = fairnessEngine.analyze(inputWith(THREE, stats))

    const closing = report.dimensions.find((d) => d.dimension === "closing")!
    expect(closing.fairness).toBeLessThan(0.75)
    expect(report.imbalances.some((i) => i.dimension === "closing")).toBe(true)
    expect(report.dimensions.find((d) => d.dimension === "opening")!.fairness).toBe(1)
  })

  it("counts employees with no statistics as having zero (they got nothing)", () => {
    // e3 has no statistics entry at all → value 0 everywhere.
    const stats = [
      statistics("e1", { openingCount: 4 }),
      statistics("e2", { openingCount: 4 }),
    ]

    const report = fairnessEngine.analyze(inputWith(THREE, stats))

    const opening = report.dimensions.find((d) => d.dimension === "opening")!
    expect(opening.evaluated).toBe(3)
    expect(opening.distribution.find((e) => e.employeeId === brand<EmployeeId>("e3"))!.value).toBe(0)
    expect(opening.fairness).toBeLessThan(1) // e3 pulls the distribution off balance
  })

  it("excludes inactive employees from the cohort", () => {
    const cohort = [employee("e1"), employee("e2"), employee("e3", "inactive")]
    const stats = [
      statistics("e1", { openingCount: 3 }),
      statistics("e2", { openingCount: 3 }),
      statistics("e3", { openingCount: 99 }), // inactive → ignored
    ]

    const report = fairnessEngine.analyze(inputWith(cohort, stats))

    expect(report.details.cohortSize).toBe(2)
    expect(report.dimensions.find((d) => d.dimension === "opening")!.fairness).toBe(1)
  })

  it("warns and skips imbalance detection when the cohort is too small", () => {
    const report = fairnessEngine.analyze(
      inputWith([employee("e1")], [statistics("e1", { workedMinutes: 5000 })])
    )

    expect(report.warnings.map((w) => w.code)).toEqual(["cohort_too_small"])
    expect(report.imbalances).toEqual([])
  })

  it("respects configurable weights (weight 0 reports but does not affect overall)", () => {
    const stats = [
      statistics("e1", { weekendCount: 8 }),
      statistics("e2", { weekendCount: 0 }),
      statistics("e3", { weekendCount: 0 }),
    ]
    const input = inputWith(THREE, stats)

    const withDefaults = fairnessEngine.analyze(input)

    // Ignore the weekend dimension in the overall score.
    const ignoreWeekend: FairnessPolicy = {
      ...DEFAULT_FAIRNESS_POLICY,
      dimensionWeights: { weekend: 0 },
    }
    const withWeekendMuted = fairnessEngine.analyze(input, { policy: ignoreWeekend })

    // The weekend dimension is still reported...
    expect(withWeekendMuted.dimensions.some((d) => d.dimension === "weekend")).toBe(true)
    // ...but muting it lifts the overall (the unfair dimension no longer counts).
    expect(withWeekendMuted.overall).toBeGreaterThan(withDefaults.overall)
    expect(withWeekendMuted.overall).toBe(1)
  })

  it("supports a new dimension via one calculator + one registration", () => {
    // A custom dimension that reads assignmentCount — no engine change needed.
    const assignmentCountFairness: FairnessDimensionCalculator = {
      dimension: "assignment_count",
      valueOf: (id, ctx) => ctx.statisticsByEmployee.get(id)?.assignmentCount ?? 0,
    }

    const registry = createDefaultFairnessRegistry()
    registry.register(assignmentCountFairness)

    const stats = [
      statistics("e1", { assignmentCount: 10 }),
      statistics("e2", { assignmentCount: 2 }),
      statistics("e3", { assignmentCount: 2 }),
    ]

    const report = fairnessEngine.analyze(inputWith(THREE, stats), { registry })

    expect(report.dimensions).toHaveLength(6)
    const custom = report.dimensions.find((d) => d.dimension === "assignment_count")!
    expect(custom.fairness).toBeLessThan(1)
    expect(report.imbalances.some((i) => i.dimension === "assignment_count")).toBe(true)
  })

  it("is deterministic for identical input", () => {
    const build = () =>
      inputWith(THREE, [
        statistics("e1", { workedMinutes: 3000, openingCount: 5 }),
        statistics("e2", { workedMinutes: 1500, openingCount: 1 }),
        statistics("e3", { workedMinutes: 1500, openingCount: 0 }),
      ])

    expect(fairnessEngine.analyze(build())).toEqual(fairnessEngine.analyze(build()))
  })
})
