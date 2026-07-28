import { describe, expect, it } from "vitest"

import type { EmployeeId, IsoDate, PlanningId } from "@/features/core/models"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { PLANNING_PROBLEM_V3_VERSION } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

/**
 * RÉGRESSION — présence concurrente sur un créneau, indépendante du
 * validateur V2 déjà couvert dans `demand-engine/__tests__/coverage-calculator.test.ts`.
 *
 * Trois salariés se relaient sur 12:00–13:00 : 06:00–12:30, 10:00–14:00,
 * 12:15–17:45. Aucun ne couvre l'heure à lui seul, mais la présence
 * simultanée réelle ne descend jamais sous 2. L'ancienne logique
 * ("un shift doit couvrir intégralement le créneau") ne comptait que le
 * salarié du milieu, `covered = 1`.
 *
 * Le problème est construit au minimum nécessaire pour isoler la règle
 * `coverage-deficit` : contrats et budget journalier collent exactement aux
 * minutes travaillées, aucune ouverture/fermeture exigée, un seul jour.
 */

const DATE = "2026-07-20" as IsoDate

function employee(id: string, contractMinutes: number) {
  return {
    id: id as unknown as EmployeeId,
    firstName: id,
    lastName: "",
    contractMinutes,
    workingDays: ["monday"] as const,
    fixedRestDays: [],
    minimumDailyMinutes: 0,
    maximumDailyMinutes: 600,
    canOpen: true,
    canClose: true,
    canSplitShift: false,
    maximumOpenings: null,
    maximumClosings: null,
    prefersOpening: false,
    prefersClosing: false,
  }
}

function employeeDay(id: string) {
  return {
    employeeId: id as unknown as EmployeeId,
    date: DATE,
    available: true,
    mandatory: false,
    fixedRest: false,
    earliestStartMinutes: 0,
    latestEndMinutes: 1440,
    maximumMinutes: 600,
  }
}

/** required=2: fully met by the true minimum presence of 2. required=3: still short by 1. */
function problemWithRequirement(requiredEmployees: number): PlanningProblemV3 {
  return {
    version: PLANNING_PROBLEM_V3_VERSION,
    planningId: "p1" as unknown as PlanningId,
    sectorId: "s1",
    period: { start: DATE, end: DATE },
    timeStepMinutes: 15,
    employees: [employee("empA", 390), employee("empB", 240), employee("empC", 330)],
    days: [
      {
        date: DATE,
        weekDay: "monday",
        weekKey: "2026-W30",
        closed: false,
        opensAtMinutes: 360,
        // Later than empC's 17:45 end (1065) on purpose: nobody's shift end
        // should coincide with closing, or `exactClosingsPerDay: 0` fires a
        // spurious `closing-count` violation this fixture has no business
        // exercising.
        closesAtMinutes: 1080,
        budgetMinutes: 960, // 390 + 240 + 330: exact, so daily-budget stays silent
      },
    ],
    employeeDays: [employeeDay("empA"), employeeDay("empB"), employeeDay("empC")],
    demandSlots: [
      {
        id: "req-1200-1300",
        date: DATE,
        startMinutes: 720, // 12:00
        endMinutes: 780, // 13:00
        requiredEmployees,
        maximumEmployees: null,
      },
    ],
    rules: {
      minimumShiftMinutes: 240,
      maximumShiftMinutes: 600,
      minimumRestMinutes: 0,
      maximumConsecutiveWorkedDays: null,
      maximumConsecutiveWorkedDaysSource: "derived-fallback",
      splitShiftAllowed: false,
      maximumSplitMinutes: null,
      minimumOpeningsPerDay: 0,
      exactClosingsPerDay: 0,
    },
    objectives: ["coverage-deficit"],
  }
}

function staggeredSolution(problem: PlanningProblemV3): PlanningSolutionV3 {
  return {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprintProblem(problem),
    assignments: [
      { employeeId: "empA" as unknown as EmployeeId, date: DATE, segments: [{ startMinutes: 360, endMinutes: 750 }] }, // 06:00–12:30
      { employeeId: "empB" as unknown as EmployeeId, date: DATE, segments: [{ startMinutes: 600, endMinutes: 840 }] }, // 10:00–14:00
      { employeeId: "empC" as unknown as EmployeeId, date: DATE, segments: [{ startMinutes: 735, endMinutes: 1065 }] }, // 12:15–17:45
    ],
  }
}

describe("validateur V3 — présence concurrente sur un créneau (le cas rapporté)", () => {
  it("aucun déficit quand le besoin (2) est couvert par la présence minimale réelle", () => {
    const problem = problemWithRequirement(2)
    const report = validatePlanningSolutionV3(problem, staggeredSolution(problem))

    expect(report.underCoveredSlots).toBe(0)
    expect(report.metrics.totalDeficitMinutes).toBe(0)
    expect(report.degradations.find((v) => v.rule === "coverage-deficit")).toBeUndefined()
    expect(report.validHardConstraints).toBe(true)
  })

  it("un besoin de 3 reste sous-couvert, mais seulement de 1 (le vrai minimum), pas de 2", () => {
    const problem = problemWithRequirement(3)
    const report = validatePlanningSolutionV3(problem, staggeredSolution(problem))

    expect(report.underCoveredSlots).toBe(1)
    // Atomic pieces: 12:00–12:15 (2 présents, manque 1 -> 15 min),
    // 12:15–12:30 (3 présents, rien ne manque), 12:30–13:00 (2 présents,
    // manque 1 sur 30 min -> 30 min). Total 45 minutes — jamais les 120
    // minutes (2 manquants * 60) que l'ancienne logique aurait rendues avec
    // assignedCount=1, ni même 60 (1 manquant * 60) en chargeant l'heure
    // entière pour un manque qui ne dure que 45 de ses 60 minutes.
    expect(report.metrics.totalDeficitMinutes).toBe(45)
    const deficit = report.degradations.find((v) => v.rule === "coverage-deficit")
    expect(deficit?.actual).toBe(2) // the true minimum presence, not 1
    expect(deficit?.expected).toBe(3)
    expect(deficit?.message).toContain("2 salarié(s) présent(s) pour 3 requis (déficit 45 minutes)")
  })
})
