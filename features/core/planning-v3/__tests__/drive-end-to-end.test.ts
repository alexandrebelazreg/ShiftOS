import { describe, expect, it } from "vitest"

import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import {
  fingerprintProblem,
  structuralSurplusOf,
  validatePlanningSolutionV3,
} from "@/features/core/planning-v3/validator"

import {
  buildDriveProblem,
  DATES,
  driveEmployeeRecords,
  generationInput,
  historicalSetupPayload,
  readMigratedSectors,
} from "@/features/core/planning-v3/__tests__/drive-problem"

/**
 * The real Drive case, end to end.
 *
 * This test deliberately does NOT start from an already-normalised Core
 * fixture. It starts from the application data a real install holds — a
 * `shiftos_first_run_setup` payload whose Drive sector predates the Sprint 3D
 * `workEveryNonFixedRestDay` flag — and drives it through the repository
 * migration and then the V3 problem builder.
 *
 * That path is the point. The previous Drive fixture set the historical flag
 * itself, so it could never reproduce the failure it was supposed to guard
 * against: a legacy sector reaching the engine without the flag and silently
 * reactivating the old behaviour.
 */

describe("Drive end-to-end — donnée applicative historique vers PlanningProblemV3", () => {
  it("migre explicitement le champ historique du secteur", () => {
    const raw = JSON.parse(historicalSetupPayload())[0] as Record<string, unknown>
    expect("workEveryNonFixedRestDay" in raw).toBe(false)

    const sectors = readMigratedSectors(historicalSetupPayload())
    expect(sectors[0].workEveryNonFixedRestDay).toBe(true)
  })

  it("refuse de générer plutôt que de retomber silencieusement sur V2", () => {
    // Same data, but the migration is bypassed: the builder must fail loudly.
    const sectors = readMigratedSectors(historicalSetupPayload())
    const input = generationInput(driveEmployeeRecords(), sectors)
    const unmigrated = {
      ...input,
      business: {
        ...input.business,
        sectors: input.business!.sectors!.map((sector) => {
          const copy = { ...sector } as Record<string, unknown>
          delete copy.workEveryNonFixedRestDay
          return copy as never
        }),
      },
    }
    const built = buildPlanningProblemV3(unmigrated)
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.errors.map((error) => error.code)).toContain("historical_field_missing")
  })

  it("expose 2 205 minutes exactes par salarié", () => {
    const problem = buildDriveProblem()
    expect(problem.employees).toHaveLength(5)
    for (const employee of problem.employees) {
      expect(employee.contractMinutes).toBe(2_205)
    }
  })

  it("calcule les budgets journaliers exacts", () => {
    const problem = buildDriveProblem()
    const budgets = problem.days
      .filter((day) => !day.closed)
      .map((day) => day.budgetMinutes)
    expect(budgets).toEqual([1_650, 1_650, 1_650, 1_650, 2_430, 1_995])
    expect(budgets.reduce((sum, value) => sum + value, 0)).toBe(5 * 2_205)
  })

  it("marque les jours obligatoirement travaillés", () => {
    const problem = buildDriveProblem()
    const luca = problem.employeeDays.filter(
      (entry) => String(entry.employeeId) === "luca" && entry.mandatory
    )
    // Six open days, all mandatory for an employee with no fixed rest day.
    expect(luca.map((entry) => entry.date)).toEqual([...DATES])
  })

  it("laisse Arthur absent le jeudi", () => {
    const problem = buildDriveProblem()
    const thursday = problem.employeeDays.find(
      (entry) => String(entry.employeeId) === "arthur" && entry.date === "2026-07-23"
    )
    expect(thursday?.available).toBe(false)
    expect(thursday?.mandatory).toBe(false)
    expect(thursday?.fixedRest).toBe(true)
    expect(thursday?.maximumMinutes).toBe(0)
  })

  it("interdit structurellement Dylan à 06:00", () => {
    const problem = buildDriveProblem()
    const dylan = problem.employees.find((employee) => String(employee.id) === "dylan")
    expect(dylan?.canOpen).toBe(false)

    // And the validator refuses a solution that puts him there anyway.
    const report = validatePlanningSolutionV3(problem, {
      version: PLANNING_SOLUTION_V3_VERSION,
      problemFingerprint: fingerprintProblem(problem),
      assignments: [
        {
          employeeId: dylan!.id,
          date: DATES[0],
          segments: [{ startMinutes: 360, endMinutes: 840 }],
        },
      ],
    })
    expect(report.violations.some((violation) => violation.rule === "opening-capability")).toBe(true)
    expect(report.validHardConstraints).toBe(false)
  })

  it("mesure un surplus structurel de 3 405 minutes", () => {
    const problem = buildDriveProblem()
    // 11 025 minutes contractuelles − 7 620 minutes de besoin = 3 405.
    const demanded = problem.demandSlots.reduce(
      (sum, slot) => sum + slot.requiredEmployees * (slot.endMinutes - slot.startMinutes),
      0
    )
    expect(demanded).toBe(7_620)
    expect(structuralSurplusOf(problem)).toBe(3_405)
  })

  it("produit un résultat strictement déterministe", () => {
    const first = buildDriveProblem()
    const second = buildDriveProblem()
    expect(fingerprintProblem(first)).toBe(fingerprintProblem(second))
    expect(second).toEqual(first)
  })
})
