import { describe, expect, it } from "vitest"

import { solvePlanningProblemV3 } from "@/features/core/planning-v3/solver"
import { solutionKey } from "@/features/core/planning-v3/solver/weekly-search/search"
import { generateCandidateSpace } from "@/features/core/planning-v3/solver/candidate-generator/generate-candidates"
import { solveAndValidatePlanningV3 } from "@/features/core/planning-v3/orchestrator/solve-and-validate"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import { solveByExhaustiveOracle } from "@/features/core/planning-v3/__tests__/exhaustive-oracle"
import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"

/**
 * The solver is checked against an oracle that enumerates every combination and
 * shares none of its code. Agreement on feasibility, on the objective vector,
 * on the exact schedule returned and on the optimality claim is what makes
 * "exact" a verified property rather than an assertion in a comment.
 */

/** The canonical key of the schedule the solver returned. */
function keyOf(problem: PlanningProblemV3, result: ReturnType<typeof solvePlanningProblemV3>): string {
  const space = generateCandidateSpace(problem)
  void space
  return (result.solution?.assignments ?? [])
    .map(
      (assignment) =>
        `${assignment.date}|${String(assignment.employeeId)}|${assignment.segments[0].startMinutes}-${assignment.segments[0].endMinutes}`
    )
    .sort()
    .join(";")
}

function agreeWithOracle(problem: PlanningProblemV3) {
  const oracle = solveByExhaustiveOracle(problem)
  const solver = solvePlanningProblemV3(problem, { timeoutMs: 20_000, maximumStates: 5_000_000 })
  return { oracle, solver }
}

describe("solveur V3 — accord avec l'oracle exhaustif", () => {
  it("1. deux salariés, deux jours, couverture parfaite atteignable", () => {
    const problem = tinyProblem()
    const { oracle, solver } = agreeWithOracle(problem)

    expect(oracle.feasible).toBe(true)
    expect(solver.status).toBe("optimal")
    expect(solver.objective).toEqual(oracle.objective)
    expect(keyOf(problem, solver)).toBe(oracle.key)
    // Perfect coverage: no under-covered slot and no deficit minute.
    expect(solver.objective?.[1]).toBe(0)
    expect(solver.objective?.[2]).toBe(0)
  })

  it("2. le repos du premier jour contraint l'ouverture du second", () => {
    // 21 h of rest between two days whose window is only 4 h: whoever closes
    // at 12:00 cannot be back at 08:00 the next morning.
    const problem = tinyProblem({ rules: { minimumRestMinutes: 1_260 } })
    const { oracle, solver } = agreeWithOracle(problem)

    expect(solver.status).toBe("optimal")
    expect(oracle.feasible).toBe(true)
    expect(solver.objective).toEqual(oracle.objective)
    expect(keyOf(problem, solver)).toBe(oracle.key)

    // The rule actually bites: nobody closes one day and opens the next.
    const byDate = new Map(
      (solver.solution?.assignments ?? []).map((a) => [`${a.date}|${String(a.employeeId)}`, a])
    )
    for (const [key, assignment] of byDate) {
      const [date, employeeId] = key.split("|")
      if (date !== problem.days[0].date) continue
      const next = byDate.get(`${problem.days[1].date}|${employeeId}`)
      if (!next) continue
      const rest = 1_440 - assignment.segments[0].endMinutes + next.segments[0].startMinutes
      expect(rest).toBeGreaterThanOrEqual(1_260)
    }
  })

  it("3. le plafond hebdomadaire de fermetures est respecté", () => {
    const problem = tinyProblem({
      employees: [
        { id: "e1", contractMinutes: 240, canOpen: true, canClose: true, maximumClosings: 1 },
        { id: "e2", contractMinutes: 240, canOpen: true, canClose: true, maximumClosings: 1 },
      ],
    })
    const { oracle, solver } = agreeWithOracle(problem)

    expect(solver.status).toBe("optimal")
    expect(solver.objective).toEqual(oracle.objective)
    expect(keyOf(problem, solver)).toBe(oracle.key)

    const closings = new Map<string, number>()
    for (const assignment of solver.solution?.assignments ?? []) {
      const day = problem.days.find((d) => d.date === assignment.date)!
      if (assignment.segments[0].endMinutes === day.closesAtMinutes) {
        closings.set(String(assignment.employeeId), (closings.get(String(assignment.employeeId)) ?? 0) + 1)
      }
    }
    for (const count of closings.values()) expect(count).toBeLessThanOrEqual(1)
  })

  it("4. budget journalier incompatible avec la capacité", () => {
    // 500 minutes are asked of two employees who can offer at most 240 each.
    const problem = tinyProblem({
      employees: [
        { id: "e1", contractMinutes: 480, canOpen: true, canClose: true },
        { id: "e2", contractMinutes: 480, canOpen: true, canClose: true },
      ],
      budgetMinutes: [500, 460],
    })
    const solver = solvePlanningProblemV3(problem)

    expect(solver.status).toBe("infeasible")
    expect(solver.solution).toBeNull()
    expect(solver.diagnostics.map((d) => d.code)).toContain("daily_budget_above_capacity")
    expect(solveByExhaustiveOracle(problem).feasible).toBe(false)
  })

  it("5. contrat hebdomadaire incompatible avec la capacité", () => {
    const problem = tinyProblem({
      employees: [
        { id: "e1", contractMinutes: 600, canOpen: true, canClose: true },
        { id: "e2", contractMinutes: 360, canOpen: true, canClose: true },
      ],
      budgetMinutes: [480, 480],
    })
    const solver = solvePlanningProblemV3(problem)

    expect(solver.status).toBe("infeasible")
    expect(solver.diagnostics.map((d) => d.code)).toContain("contract_above_capacity")
    expect(solveByExhaustiveOracle(problem).feasible).toBe(false)
  })

  it("6. le meilleur choix journalier local n'est pas le meilleur choix hebdomadaire", () => {
    // Only e1 can open, and 21 h of rest stop a closer from opening the next
    // day. A day-by-day engine that picks the locally best Monday can strand
    // Tuesday; the weekly search sees both days at once.
    const problem = tinyProblem({
      rules: { minimumRestMinutes: 1_260 },
      employees: [
        { id: "e1", contractMinutes: 300, canOpen: true, canClose: true },
        { id: "e2", contractMinutes: 180, canOpen: false, canClose: true },
      ],
    })
    const { oracle, solver } = agreeWithOracle(problem)

    expect(oracle.feasible).toBe(true)
    expect(solver.status).toBe("optimal")
    expect(solver.objective).toEqual(oracle.objective)
    expect(keyOf(problem, solver)).toBe(oracle.key)
    // More than one legal week exists, so the choice is a real one.
    expect(oracle.legalSolutionCount).toBeGreaterThan(1)

    // e1 opens both days, which is only possible because e1 never closes the
    // first day — the coupling a daily optimiser cannot see.
    const monday = solver.solution!.assignments.filter((a) => a.date === problem.days[0].date)
    const e1Monday = monday.find((a) => String(a.employeeId) === "e1")!
    expect(e1Monday.segments[0].startMinutes).toBe(problem.days[0].opensAtMinutes)
    expect(e1Monday.segments[0].endMinutes).not.toBe(problem.days[0].closesAtMinutes)
  })

  it("7. plusieurs solutions équivalentes sont départagées de façon déterministe", () => {
    // Two interchangeable employees and a single legal shift length: several
    // schedules tie on every objective, so only the canonical key separates
    // them.
    const problem = tinyProblem({
      employees: [
        { id: "e1", contractMinutes: 240, canOpen: true, canClose: true },
        { id: "e2", contractMinutes: 240, canOpen: true, canClose: true },
      ],
      rules: { minimumShiftMinutes: 120, maximumShiftMinutes: 120 },
    })
    const { oracle, solver } = agreeWithOracle(problem)

    expect(oracle.feasible).toBe(true)
    expect(oracle.legalSolutionCount).toBeGreaterThan(1)
    expect(solver.status).toBe("optimal")
    expect(solver.objective).toEqual(oracle.objective)
    expect(keyOf(problem, solver)).toBe(oracle.key)

    // And the same answer on every run.
    const again = solvePlanningProblemV3(problem)
    expect(keyOf(problem, again)).toBe(keyOf(problem, solver))
    expect(solutionKey([])).toBe("")
  })
})

describe("solveur V3 — audit par le validateur indépendant", () => {
  it("ne produit jamais une solution que le validateur rejette", () => {
    for (const problem of [
      tinyProblem(),
      tinyProblem({ rules: { minimumRestMinutes: 1_260 } }),
      tinyProblem({ rules: { minimumShiftMinutes: 120, maximumShiftMinutes: 120 } }),
    ]) {
      const audited = solveAndValidatePlanningV3(problem)
      expect(audited.solverContradictedByValidator).toBe(false)
      expect(audited.report?.validHardConstraints).toBe(true)
    }
  })
})
