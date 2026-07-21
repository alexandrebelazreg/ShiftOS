import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"

import type { PlanningGenerationInput } from "@/features/core/planning-generator"
import { planningGenerator as sprintAwarePlanningGenerator } from "@/features/core/planning-generator"

import {
  brand,
  builtInRegistry,
  contract,
  demand,
  employee,
  requirement,
  settings,
  store,
} from "@/features/core/planning-generator/__tests__/fixtures"

const planningGenerator = { generate: (input: PlanningGenerationInput, options?: Parameters<typeof sprintAwarePlanningGenerator.generate>[1]) => sprintAwarePlanningGenerator.generate({ ...input, business: { ...input.business, pipelineMode: "legacy-v2" } }, options) }

/** Assemble a full input with the built-in constraints registered. */
function makeInput(
  employees: ReturnType<typeof employee>[],
  requirements: ReturnType<typeof requirement>[],
  contracts: ReturnType<typeof contract>[]
): PlanningGenerationInput {
  return {
    store: store(),
    employees,
    demand: demand(requirements),
    registry: builtInRegistry(),
    settings: settings(),
    contracts,
  }
}

const MON = "2026-07-06"
const TUE = "2026-07-07"
const WED = "2026-07-08"

describe("planningGenerator.generate", () => {
  it("produces a simple valid planning", () => {
    const e1 = employee("e1")
    const e2 = employee("e2")
    const input = makeInput([e1, e2], [requirement("r1", MON, 1)], [
      contract("e1"),
      contract("e2"),
    ])

    const result = planningGenerator.generate(input)

    expect(result.assignments.length).toBeGreaterThanOrEqual(1)
    expect(result.assignments[0].employeeId).toBe(brand<EmployeeId>("e1"))
    expect(result.shifts.length).toBeGreaterThanOrEqual(1)
    expect(result.constraintReport.feasible).toBe(true)
    expect(result.coverage.statistics.covered).toBe(1)
    expect(result.score.feasible).toBe(true)
    expect(result.statistics.requirementsFullyCovered).toBe(1)
    expect(result.statistics.employeesAssigned).toBeGreaterThanOrEqual(1)
    expect(result.statistics.strategy).toBe("business-pipeline-v2")
  })

  it("handles no employees (empty planning, coverage gap)", () => {
    const input = makeInput([], [requirement("r1", MON, 1)], [])

    const result = planningGenerator.generate(input)

    expect(result.assignments).toEqual([])
    expect(result.shifts).toEqual([])
    expect(result.statistics.employeesAssigned).toBe(0)
    expect(result.statistics.requirementsUncovered).toBe(1)
    expect(result.coverage.statistics.underCovered).toBe(1)
    // No shifts ⇒ no hard breach, but the demand is unmet ⇒ scoring warns.
    expect(result.constraintReport.feasible).toBe(true)
    expect(result.score.warnings.some((w) => w.code === "coverage_gap")).toBe(true)
  })

  it("leaves impossible demand partially covered", () => {
    const e1 = employee("e1")
    const e2 = employee("e2")
    const input = makeInput([e1, e2], [requirement("r1", MON, 5)], [
      contract("e1"),
      contract("e2"),
    ])

    const result = planningGenerator.generate(input)

    expect(result.assignments.filter((assignment) => String(assignment.shiftId).endsWith("_r1"))).toHaveLength(2)
    expect(result.coverage.statistics.underCovered).toBe(1)
    expect(result.statistics.requirementsPartiallyCovered).toBe(1)
    expect(result.coverage.results[0].coveragePercentage).toBeCloseTo(0.4, 5)
    expect(result.score.feasible).toBe(true)
  })

  it("filters out unavailable employees via the constraint engine", () => {
    // Unavailable employee is tried FIRST; only the available one should land.
    const eUnavailable = employee("e_unavailable")
    const eAvailable = employee("e_available")
    const input = makeInput(
      [eUnavailable, eAvailable],
      [requirement("r1", MON, 1)],
      [
        contract("e_unavailable", ["tuesday"]), // not available on Monday
        contract("e_available"), // whole week
      ]
    )

    const result = planningGenerator.generate(input)

    expect(result.assignments.filter((assignment) => String(assignment.shiftId).endsWith("_r1"))).toHaveLength(1)
    expect(result.assignments.find((assignment) => String(assignment.shiftId).endsWith("_r1"))?.employeeId).toBe(brand<EmployeeId>("e_available"))
    expect(result.statistics.candidatesRejectedByHardConstraints).toBeGreaterThanOrEqual(1)
    expect(result.constraintReport.feasible).toBe(true)
  })

  it("produces a partial planning across several requirements", () => {
    const e1 = employee("e1")
    const e2 = employee("e2")
    const input = makeInput(
      [e1, e2],
      [
        requirement("r1", MON, 1),
        requirement("r2", TUE, 1),
        requirement("r3", WED, 3), // needs 3, only 2 exist
      ],
      [contract("e1"), contract("e2")]
    )

    const result = planningGenerator.generate(input)

    expect(result.statistics.requirementsTotal).toBe(3)
    expect(result.statistics.requirementsFullyCovered).toBe(2) // r1, r2
    expect(result.statistics.requirementsPartiallyCovered).toBe(1) // r3
    expect(result.statistics.requirementsUncovered).toBe(0)
    expect(result.shifts.length).toBeGreaterThanOrEqual(3)
    expect(result.score.feasible).toBe(true)
  })

  it("blocks rather than exceeding a tiny weekly contract", () => {
    const e1 = employee("e1")
    const tightContract = { ...contract("e1"), weeklyHours: 1 }
    const input = makeInput([e1], [requirement("r1", MON, 1)], [tightContract])

    const result = planningGenerator.generate(input)

    expect(result.assignments).toHaveLength(0)
    expect(result.status).toBe("blocked")
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "contract_inexact", severity: "blocking" }))
  })

  it("is deterministic for identical input", () => {
    const build = () =>
      makeInput(
        [employee("e1"), employee("e2")],
        [requirement("r1", MON, 1), requirement("r2", TUE, 2)],
        [contract("e1"), contract("e2")]
      )

    // The generator's DECISIONS are deterministic. The constraint engine stamps
    // wall-clock telemetry (`durationMs`, `evaluatedAt`) that is not, so compare
    // the meaningful, decision-bearing projection.
    const project = (r: ReturnType<typeof planningGenerator.generate>) => ({
      assignments: r.assignments,
      shifts: r.shifts,
      coverage: r.coverage.statistics,
      fairnessOverall: r.fairness.overall,
      overall: r.score.overall,
      feasible: r.score.feasible,
      statistics: r.statistics,
    })

    expect(project(planningGenerator.generate(build()))).toEqual(
      project(planningGenerator.generate(build()))
    )
  })

  it("accepts a pluggable strategy without touching the generator", () => {
    // A trivial strategy that assigns nobody — proves the seam is open.
    const emptyStrategy = {
      name: "empty",
      generate: () => ({
        shifts: [],
        assignments: [],
        candidatesRejectedByHardConstraints: 0,
        constraintEvaluations: 0,
        assignmentRankings: [],
      }),
    }
    const input = makeInput([employee("e1")], [requirement("r1", MON, 1)], [contract("e1")])

    const result = planningGenerator.generate(input, { strategy: emptyStrategy })

    expect(result.statistics.strategy).toBe("empty")
    expect(result.assignments).toEqual([])
  })
})
