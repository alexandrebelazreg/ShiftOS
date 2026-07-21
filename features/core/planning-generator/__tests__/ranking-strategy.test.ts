import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"

import type { PlanningGenerationInput } from "@/features/core/planning-generator"
import { planningGenerator, sequentialAssignmentStrategy } from "@/features/core/planning-generator"

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

const MON = "2026-07-06"
const TUE = "2026-07-07"
const WED = "2026-07-08"
const THU = "2026-07-09"

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

const countFor = (result: ReturnType<typeof planningGenerator.generate>, id: string) =>
  result.assignments.filter((a) => a.employeeId === brand<EmployeeId>(id)).length

const RANKING_DIMENSIONS = ["contract_balance", "fairness", "current_workload_balance"]
const generateSequential = (input: PlanningGenerationInput) => planningGenerator.generate(input, { strategy: sequentialAssignmentStrategy })

describe("sequential-assignment strategy — candidate ranking", () => {
  it("ranks every compatible employee and records the breakdown", () => {
    const result = generateSequential(
      makeInput([employee("e1"), employee("e2")], [requirement("r1", MON, 1)], [
        contract("e1"),
        contract("e2"),
      ])
    )

    expect(result.assignmentRankings).toHaveLength(1)
    const ranking = result.assignmentRankings[0]
    // Both compatible employees were evaluated: one selected, one alternative.
    expect(ranking.alternatives).toHaveLength(1)
    // The selected candidate carries a per-dimension breakdown (explainability).
    expect(ranking.selected.contributions.map((c) => c.dimension)).toEqual(RANKING_DIMENSIONS)
    expect(typeof ranking.selected.score).toBe("number")
  })

  it("balances workload instead of always picking the first compatible employee", () => {
    // First-compatible would give e1 all four days; ranking must spread them.
    const result = generateSequential(
      makeInput(
        [employee("e1"), employee("e2")],
        [
          requirement("r1", MON, 1),
          requirement("r2", TUE, 1),
          requirement("r3", WED, 1),
          requirement("r4", THU, 1),
        ],
        [contract("e1"), contract("e2")]
      )
    )

    const e1 = countFor(result, "e1")
    const e2 = countFor(result, "e2")
    expect(e1 + e2).toBe(4)
    expect(e2).toBeGreaterThan(0) // first-compatible behaviour would leave this at 0
    expect(Math.abs(e1 - e2)).toBeLessThanOrEqual(1) // balanced
  })

  it("lets fairness / workload debt influence the next assignment", () => {
    const result = generateSequential(
      makeInput([employee("e1"), employee("e2")], [
        requirement("r1", MON, 1),
        requirement("r2", TUE, 1),
      ], [contract("e1"), contract("e2")])
    )

    // r1 ties → e1 (id order); r2 must swing to e2 once e1 carries a shift.
    const second = result.assignmentRankings[1]
    expect(second.selected.employeeId).toBe(brand<EmployeeId>("e2"))
    expect(second.alternatives[0].employeeId).toBe(brand<EmployeeId>("e1"))

    const fairnessOf = (contributions: readonly { dimension: string; rawScore: number }[]) =>
      contributions.find((c) => c.dimension === "fairness")!.rawScore
    // The chosen employee has the lower fairness debt (higher fairness score).
    expect(fairnessOf(second.selected.contributions)).toBeGreaterThanOrEqual(
      fairnessOf(second.alternatives[0].contributions)
    )
  })

  it("only ranks compatible employees (incompatible are gated out first)", () => {
    // e_unavailable cannot work Monday; only e_available may be assigned.
    const result = generateSequential(
      makeInput(
        [employee("e_unavailable"), employee("e_available")],
        [requirement("r1", MON, 1)],
        [contract("e_unavailable", ["tuesday"]), contract("e_available")]
      )
    )

    const ranking = result.assignmentRankings[0]
    expect(ranking.selected.employeeId).toBe(brand<EmployeeId>("e_available"))
    // The incompatible employee never entered ranking (no alternatives).
    expect(ranking.alternatives).toHaveLength(0)
    expect(result.statistics.candidatesRejectedByHardConstraints).toBeGreaterThanOrEqual(1)
  })

  it("is deterministic (assignments and rankings identical across runs)", () => {
    const build = () =>
      makeInput(
        [employee("e1"), employee("e2"), employee("e3")],
        [requirement("r1", MON, 2), requirement("r2", TUE, 1), requirement("r3", WED, 1)],
        [contract("e1"), contract("e2"), contract("e3")]
      )

    const a = generateSequential(build())
    const b = generateSequential(build())
    expect(a.assignments).toEqual(b.assignments)
    expect(a.assignmentRankings).toEqual(b.assignmentRankings)
  })
})
