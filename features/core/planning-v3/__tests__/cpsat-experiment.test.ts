import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { buildDriveProblem } from "@/features/core/planning-v3/__tests__/drive-problem"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import type { PlanningAssignmentV3 } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

/**
 * Guards for the CP-SAT spike in `experiments/planning-v3-cpsat/`.
 *
 * The spike solves a JSON snapshot of the Drive problem. A snapshot rots
 * silently: change the builder, the historical fixture or a rule, and the
 * committed JSON quietly stops describing the problem the application would
 * actually pose — while the experiment keeps reporting a result about the OLD
 * problem, and the result reads as if it still applied.
 *
 * These tests close that gap. The first regenerates the problem from the real
 * builder and fails when it no longer matches the committed file. The second
 * re-audits the committed CP-SAT answer with the independent V3A validator, so
 * the spike's claims are never taken on trust from a Python script.
 *
 * Set `UPDATE_CPSAT_FIXTURE=1` to rewrite the snapshot after an intended change.
 */

const ROOT = join(process.cwd(), "experiments", "planning-v3-cpsat")
const PROBLEM_PATH = join(ROOT, "fixtures", "drive-problem.json")
const SOLUTION_PATH = join(ROOT, "expected", "cpsat-solution.json")

const problem = buildDriveProblem()
const assignments = JSON.parse(readFileSync(SOLUTION_PATH, "utf8")) as PlanningAssignmentV3[]

describe("spike CP-SAT — la fixture reste fidèle au builder V3", () => {
  it("régénère un problème identique au fichier committé", () => {
    const regenerated = `${JSON.stringify(problem, null, 2)}\n`

    if (process.env.UPDATE_CPSAT_FIXTURE === "1") {
      writeFileSync(PROBLEM_PATH, regenerated, "utf8")
    }

    expect(existsSync(PROBLEM_PATH)).toBe(true)
    const committed = readFileSync(PROBLEM_PATH, "utf8")

    // Compare the parsed values, then the exact text: the first gives a usable
    // diff when something changes, the second catches formatting drift that
    // would make the Python side read a different file than the one reviewed.
    expect(JSON.parse(committed)).toEqual(JSON.parse(regenerated))
    expect(committed).toBe(regenerated)
  })

  it("est déterministe et conserve son empreinte", () => {
    expect(fingerprintProblem(buildDriveProblem())).toBe(fingerprintProblem(problem))
    // Pinned so a silent change to the builder, a rule or the fixture is caught
    // even if the JSON were regenerated at the same time.
    //
    // Moved three times, all deliberately:
    //
    // 1. from `p3_29f16d47dacffd2b` when `PlanningRulesV3` gained
    //    `minimumSplitMinutes`, `maximumContinuousMinutes` and
    //    `maximumSplitsPerDay`, which the builder now emits;
    // 2. from `p3_ad1f4d1ed24c06a2` when the fingerprint stopped ignoring a
    //    slot's `hardMinimumEmployees` and `maximumEmployees`. It had been
    //    giving one identity to problems whose unbreakable floors differ — the
    //    exact collision this pin exists to catch, found by the pin failing to
    //    move when a floor was added;
    // 3. from `p3_75ef2246a8b1f5aa` when it stopped ignoring the per-person
    //    daily bounds, the right to split, and the `employeeDays` entries
    //    entirely. A week where someone was AWAY carried the same identity as
    //    the week where they were present.
    //
    // None of them alters what the validator checks: the committed CP-SAT
    // answer still passes its audit below.
    expect(fingerprintProblem(problem)).toBe("p3_a37813575087daa3")
  })
})

describe("spike CP-SAT — la solution committée passe le validateur V3A", () => {
  const report = validatePlanningSolutionV3(problem, {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprintProblem(problem),
    assignments,
  })

  it("ne viole aucune contrainte dure", () => {
    expect(report.validHardConstraints).toBe(true)
    expect(report.violations).toEqual([])
  })

  it("expose exactement le déficit annoncé par le spike", () => {
    expect(report.underCoveredSlots).toBe(1)
    expect(report.metrics.totalDeficitMinutes).toBe(60)
    expect(report.metrics.structuralSurplusMinutes).toBe(3_405)
    expect(report.requiresExplicitAcceptance).toBe(true)
  })

  it("respecte contrats et budgets journaliers", () => {
    const weekKey = problem.days[0].weekKey
    for (const employee of problem.employees) {
      expect(report.metrics.weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`]).toBe(2_205)
    }
    expect(problem.days.filter((d) => !d.closed).map((d) => report.metrics.dailyMinutesByDate[d.date]))
      .toEqual([1_650, 1_650, 1_650, 1_650, 2_430, 1_995])
  })

  it("respecte les repos fixes et les capacités, par identifiant de fixture", () => {
    // The employee ids come from the fixture; the Python model knows none of
    // them — it reads capabilities and availability from the problem only.
    const restDay = problem.employeeDays.find((entry) => entry.fixedRest && !entry.available)
    expect(restDay).toBeDefined()
    expect(
      assignments.some((a) => String(a.employeeId) === String(restDay!.employeeId) && a.date === restDay!.date)
    ).toBe(false)

    const nonOpeners = problem.employees.filter((employee) => !employee.canOpen)
    expect(nonOpeners.length).toBeGreaterThan(0)
    for (const employee of nonOpeners) {
      for (const assignment of assignments.filter((a) => String(a.employeeId) === String(employee.id))) {
        const day = problem.days.find((d) => d.date === assignment.date)!
        expect(assignment.segments[0].startMinutes).not.toBe(day.opensAtMinutes)
      }
    }
  })

  it("ne laisse qu'un seul créneau court, d'un seul salarié", () => {
    // Which slot ends up short is NOT determined: several schedules reach the
    // proven optimum (1 slot, 60 minutes) and they do not all sacrifice the
    // same one. Asserting a particular date here would pin an accident of the
    // search rather than a property of the problem.
    const short = problem.demandSlots
      .map((slot) => {
        const covered = assignments.filter(
          (a) =>
            a.date === slot.date &&
            a.segments[0].startMinutes <= slot.startMinutes &&
            a.segments[0].endMinutes >= slot.endMinutes
        ).length
        return { slot, missing: slot.requiredEmployees - covered }
      })
      .filter((entry) => entry.missing > 0)

    expect(short).toHaveLength(1)
    expect(short[0].missing).toBe(1)
    expect(short[0].slot.endMinutes - short[0].slot.startMinutes).toBe(60)
  })

  it("assure une fermeture exacte par jour ouvert, repos et durées légales", () => {
    for (const day of problem.days.filter((d) => !d.closed)) {
      const closers = assignments.filter(
        (a) => a.date === day.date && a.segments[a.segments.length - 1].endMinutes === day.closesAtMinutes
      )
      expect(closers).toHaveLength(1)
    }

    for (const assignment of assignments) {
      const minutes = assignment.segments.reduce((sum, s) => sum + (s.endMinutes - s.startMinutes), 0)
      expect(minutes).toBeGreaterThanOrEqual(problem.rules.minimumShiftMinutes)
      expect(minutes).toBeLessThanOrEqual(problem.rules.maximumShiftMinutes)
    }

    for (const employee of problem.employees) {
      const worked = assignments
        .filter((a) => String(a.employeeId) === String(employee.id))
        .sort((left, right) => left.date.localeCompare(right.date))
      for (let index = 1; index < worked.length; index++) {
        const previous = worked[index - 1]
        const current = worked[index]
        const gapDays =
          (Date.parse(`${current.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86_400_000
        const rest =
          gapDays * 1_440 -
          previous.segments[previous.segments.length - 1].endMinutes +
          current.segments[0].startMinutes
        expect(rest).toBeGreaterThanOrEqual(problem.rules.minimumRestMinutes)
      }
    }
  })
})

/**
 * Business cost of a shortfall: missing employee-minutes weighted by the budget
 * of the day they fall on.
 *
 * Implemented here in TypeScript so the ordering the third CP-SAT pass encodes
 * is checked by something other than the Python model that produced it.
 */
function businessDeficitCost(
  slots: readonly { date: string; startMinutes: number; endMinutes: number; requiredEmployees: number }[],
  budgetByDate: Readonly<Record<string, number>>,
  assignments: readonly PlanningAssignmentV3[]
): { cost: number; underCovered: number; deficitMinutes: number } {
  let cost = 0
  let underCovered = 0
  let deficitMinutes = 0
  for (const slot of slots) {
    const covered = assignments.filter(
      (a) =>
        a.date === slot.date &&
        a.segments.some((s) => s.startMinutes <= slot.startMinutes && s.endMinutes >= slot.endMinutes)
    ).length
    const missing = slot.requiredEmployees - covered
    if (missing <= 0) continue
    const minutes = missing * (slot.endMinutes - slot.startMinutes)
    underCovered++
    deficitMinutes += minutes
    cost += minutes * budgetByDate[slot.date]
  }
  return { cost, underCovered, deficitMinutes }
}

describe("spike CP-SAT — les budgets journaliers sont des contraintes exactes", () => {
  it("fige les budgets Drive avant toute résolution", () => {
    // The solver picks employees, durations and start times. It can never move
    // a minute between two days, nor change a budget: these are inputs.
    expect(problem.days.filter((d) => !d.closed).map((d) => d.budgetMinutes))
      .toEqual([1_650, 1_650, 1_650, 1_650, 2_430, 1_995])
    expect(problem.days.filter((d) => d.closed).every((d) => d.budgetMinutes === 0)).toBe(true)
    // The budgets exhaust the contracts exactly, which is what makes them rigid.
    expect(problem.days.reduce((sum, d) => sum + d.budgetMinutes, 0))
      .toBe(problem.employees.reduce((sum, e) => sum + e.contractMinutes, 0))
  })
})

describe("spike CP-SAT — le troisième objectif protège les jours à budget élevé", () => {
  const budgetByDate = Object.fromEntries(problem.days.map((d) => [d.date, d.budgetMinutes]))
  const slots = problem.demandSlots.map((s) => ({
    date: s.date,
    startMinutes: s.startMinutes,
    endMinutes: s.endMinutes,
    requiredEmployees: s.requiredEmployees,
  }))

  it("place le déficit sur le jour au budget le plus faible qui puisse le porter", () => {
    const measured = businessDeficitCost(slots, budgetByDate, assignments)
    expect(measured.underCovered).toBe(1)
    expect(measured.deficitMinutes).toBe(60)
    // 60 minutes on a 1 650-minute day. The pass-2 solution before the third
    // objective existed sat on the 1 995-minute Saturday, at 119 700.
    expect(measured.cost).toBe(99_000)
    expect(measured.cost).toBeLessThan(60 * 1_995)

    const deficitDay = problem.days.find((d) =>
      slots.some(
        (s) =>
          s.date === d.date &&
          s.requiredEmployees >
            assignments.filter(
              (a) =>
                a.date === s.date &&
                a.segments.some((g) => g.startMinutes <= s.startMinutes && g.endMinutes >= s.endMinutes)
            ).length
      )
    )!
    const openBudgets = problem.days.filter((d) => !d.closed).map((d) => d.budgetMinutes)
    expect(deficitDay.budgetMinutes).toBe(Math.min(...openBudgets))
  })

  it("classe un déficit à budget faible devant un déficit équivalent à budget élevé", () => {
    // A TEST OF THE RANKING FORMULA, on a two-day case independent of Drive.
    //
    // It checks the ordering the third pass encodes; it does NOT run CP-SAT and
    // is NOT evidence that the solver arbitrates this artificial case. The
    // effective demonstration of pass 3 is the Drive case, where the business
    // cost drops from 119 700 to 99 000.
    //
    // At equal slots and equal minutes, the higher-budget day is the one
    // protected. Neither day is intrinsically less important.
    const budgets = { "2030-01-01": 1_650, "2030-01-02": 2_430 }
    const twoDaySlots = [
      { date: "2030-01-01", startMinutes: 360, endMinutes: 420, requiredEmployees: 2 },
      { date: "2030-01-02", startMinutes: 360, endMinutes: 420, requiredEmployees: 2 },
    ]
    const person = (id: string, date: string) => ({
      employeeId: id as unknown as PlanningAssignmentV3["employeeId"],
      date,
      segments: [{ startMinutes: 360, endMinutes: 420 }],
    })

    // Variant A leaves the LOW-budget day one person short.
    const variantA = [person("a", "2030-01-01"), person("a", "2030-01-02"), person("b", "2030-01-02")]
    // Variant B leaves the HIGH-budget day short. Same shortfall, same minutes.
    const variantB = [person("a", "2030-01-01"), person("b", "2030-01-01"), person("a", "2030-01-02")]

    const a = businessDeficitCost(twoDaySlots, budgets, variantA)
    const b = businessDeficitCost(twoDaySlots, budgets, variantB)

    // The first two objectives are strictly identical — nothing is traded away.
    expect(a.underCovered).toBe(b.underCovered)
    expect(a.deficitMinutes).toBe(b.deficitMinutes)
    // Only the third objective separates them, and it prefers variant A.
    expect(a.cost).toBe(60 * 1_650)
    expect(b.cost).toBe(60 * 2_430)
    expect(a.cost).toBeLessThan(b.cost)
  })
})
