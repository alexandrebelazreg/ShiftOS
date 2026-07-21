import { describe, expect, it } from "vitest"

import { coverageCalculator } from "@/features/core/demand-engine/calculators/coverage-calculator"

import {
  EMP,
  OTHER_EMP,
  assignment,
  coverageWindow,
  demand,
  employee,
  requirement,
  segment,
  shift,
} from "@/features/core/demand-engine/__tests__/fixtures"

const DATE = "2026-07-06"
const win = coverageWindow(DATE, "09:00", "17:00")

describe("coverageCalculator", () => {
  it("handles an empty demand", () => {
    const coverage = coverageCalculator.calculate({
      demand: demand([]),
      assignments: [],
      shifts: [],
      employees: [],
    })

    expect(coverage.results).toEqual([])
    expect(coverage.gaps).toEqual([])
    expect(coverage.statistics.totalRequirements).toBe(0)
    expect(coverage.statistics.overallCoveragePercentage).toBe(1)
  })

  it("reports perfect coverage", () => {
    const s = shift("s1", DATE, [segment("09:00", "17:00")])
    const coverage = coverageCalculator.calculate({
      demand: demand([requirement("r1", win, { min: 1 })]),
      assignments: [assignment(s.id, EMP)],
      shifts: [s],
      employees: [employee(EMP)],
    })

    const [result] = coverage.results
    expect(result.status).toBe("covered")
    expect(result.assignedCount).toBe(1)
    expect(result.coveragePercentage).toBe(1)
    expect(result.coveringEmployees).toEqual([EMP])
    expect(coverage.gaps).toEqual([])
    expect(coverage.statistics.covered).toBe(1)
  })

  it("reports under-coverage with a gap", () => {
    const s = shift("s1", DATE, [segment("09:00", "17:00")])
    const coverage = coverageCalculator.calculate({
      demand: demand([requirement("r1", win, { min: 2 })]),
      assignments: [assignment(s.id, EMP)],
      shifts: [s],
      employees: [employee(EMP)],
    })

    const [result] = coverage.results
    expect(result.status).toBe("under_covered")
    expect(result.assignedCount).toBe(1)
    expect(result.coveragePercentage).toBe(0.5)
    expect(coverage.gaps).toEqual([
      {
        requirementId: result.requirementId,
        window: win,
        missingEmployees: 1,
        missingCapabilities: [],
      },
    ])
  })

  it("reports over-coverage", () => {
    const s1 = shift("s1", DATE, [segment("09:00", "17:00")])
    const s2 = shift("s2", DATE, [segment("09:00", "17:00")])
    const coverage = coverageCalculator.calculate({
      demand: demand([requirement("r1", win, { min: 1, max: 1 })]),
      assignments: [assignment(s1.id, EMP), assignment(s2.id, OTHER_EMP)],
      shifts: [s1, s2],
      employees: [employee(EMP), employee(OTHER_EMP)],
    })

    const [result] = coverage.results
    expect(result.status).toBe("over_covered")
    expect(result.assignedCount).toBe(2)
  })

  it("detects missing capabilities even when head-count is met", () => {
    const s = shift("s1", DATE, [segment("09:00", "17:00")])
    const coverage = coverageCalculator.calculate({
      demand: demand([
        requirement("r1", win, { min: 1, capabilities: ["CAN_OPEN"] }),
      ]),
      assignments: [assignment(s.id, EMP)],
      shifts: [s],
      employees: [employee(EMP, [])], // no CAN_OPEN
    })

    const [result] = coverage.results
    expect(result.status).toBe("covered") // head-count met
    expect(result.missingCapabilities).toEqual(["CAN_OPEN"])
    expect(coverage.gaps).toHaveLength(1)
    expect(coverage.gaps[0].missingCapabilities).toEqual(["CAN_OPEN"])
  })

  it("clears the capability gap when a covering employee has the capability", () => {
    const s = shift("s1", DATE, [segment("09:00", "17:00")])
    const coverage = coverageCalculator.calculate({
      demand: demand([
        requirement("r1", win, { min: 1, capabilities: ["CAN_OPEN"] }),
      ]),
      assignments: [assignment(s.id, EMP)],
      shifts: [s],
      employees: [employee(EMP, ["CAN_OPEN"])],
    })

    expect(coverage.results[0].missingCapabilities).toEqual([])
    expect(coverage.gaps).toEqual([])
  })

  it("evaluates multiple windows independently and aggregates", () => {
    const win1 = coverageWindow("2026-07-06", "09:00", "13:00")
    const win2 = coverageWindow("2026-07-07", "13:00", "17:00")
    // Covers win1 only; nothing overlaps win2.
    const s1 = shift("s1", "2026-07-06", [segment("09:00", "13:00")])

    const coverage = coverageCalculator.calculate({
      demand: demand([
        requirement("r1", win1, { min: 1 }),
        requirement("r2", win2, { min: 1 }),
      ]),
      assignments: [assignment(s1.id, EMP)],
      shifts: [s1],
      employees: [employee(EMP)],
    })

    expect(coverage.results).toHaveLength(2)
    expect(coverage.results[0].status).toBe("covered")
    expect(coverage.results[1].status).toBe("under_covered")
    expect(coverage.statistics.covered).toBe(1)
    expect(coverage.statistics.underCovered).toBe(1)
    expect(coverage.statistics.overallCoveragePercentage).toBe(0.5)
    expect(coverage.gaps).toHaveLength(1)
  })

  it("ignores assignments whose shift does not overlap the window", () => {
    const s = shift("s1", DATE, [segment("06:00", "08:00")]) // before the window
    const coverage = coverageCalculator.calculate({
      demand: demand([requirement("r1", win, { min: 1 })]),
      assignments: [assignment(s.id, EMP)],
      shifts: [s],
      employees: [employee(EMP)],
    })

    expect(coverage.results[0].assignedCount).toBe(0)
    expect(coverage.results[0].status).toBe("under_covered")
  })

  it("expose une présence partielle sans la compter comme couverture complète", () => {
    const s = shift("s1", DATE, [segment("10:00", "16:30")])
    const coverage = coverageCalculator.calculate({ demand: demand([requirement("r1", coverageWindow(DATE, "16:00", "17:00"), { min: 1 })]), assignments: [assignment(s.id, EMP)], shifts: [s], employees: [employee(EMP)] })
    expect(coverage.results[0]).toEqual(expect.objectContaining({ assignedCount: 0, status: "under_covered", coveringEmployees: [], partiallyCoveringEmployees: [EMP], coveredEmployeeMinutes: 30, partialCoverageMinutes: 30 }))
  })
})
