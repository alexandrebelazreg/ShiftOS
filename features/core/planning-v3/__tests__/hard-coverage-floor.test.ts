import { describe, expect, it } from "vitest"

import type { EmployeeId, IsoDate, PlanningId } from "@/features/core/models"
import type {
  PlanningDemandSlotV3,
  PlanningProblemV3,
} from "@/features/core/planning-v3/types/problem"
import { PLANNING_PROBLEM_V3_VERSION } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

/**
 * Le plancher opérationnel dur — `PlanningDemandSlotV3.hardMinimumEmployees`.
 *
 * Deux besoins vivent sur le même créneau et ne se comportent pas pareil :
 *
 * - `requiredEmployees` est la CIBLE métier. Les minutes contractuelles sont
 *   finies ; une demande qui les dépasse laisse tout planning court quelque
 *   part. Y manquer est une dégradation à accepter explicitement.
 * - `hardMinimumEmployees` est le PLANCHER. « Quelqu'un doit être présent en
 *   continu » n'est pas un objectif dégradable : c'est ce qui permet au
 *   magasin d'ouvrir. Y manquer est bloquant.
 *
 * La vérification est atomique : le plancher est comparé à la présence
 * concurrente MINIMALE de la fenêtre, pas à une moyenne ni à un test de
 * recouvrement par shift. Un créneau tenu partout sauf quinze minutes échoue.
 *
 * Le champ est optionnel et son absence doit laisser le comportement
 * historique strictement inchangé — c'est la première chose vérifiée ici.
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

function problemWith(slot: PlanningDemandSlotV3): PlanningProblemV3 {
  return {
    version: PLANNING_PROBLEM_V3_VERSION,
    planningId: "p1" as unknown as PlanningId,
    sectorId: "s1",
    period: { start: DATE, end: DATE },
    timeStepMinutes: 15,
    employees: [employee("empA", 390), employee("empB", 240)],
    days: [
      {
        date: DATE,
        weekDay: "monday",
        weekKey: "2026-W30",
        closed: false,
        opensAtMinutes: 360,
        closesAtMinutes: 1080,
        budgetMinutes: 630, // 390 + 240, exact
      },
    ],
    employeeDays: [employeeDay("empA"), employeeDay("empB")],
    demandSlots: [slot],
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

/**
 * empA 06:00–12:30, empB 12:30–16:30.
 *
 * La relève est exacte : la présence ne tombe jamais à zéro entre 06:00 et
 * 16:30, mais elle vaut 1 partout sauf à l'instant de bascule. Un plancher de 1
 * passe, un plancher de 2 échoue.
 */
function relaySolution(problem: PlanningProblemV3): PlanningSolutionV3 {
  return {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprintProblem(problem),
    assignments: [
      { employeeId: "empA" as unknown as EmployeeId, date: DATE, segments: [{ startMinutes: 360, endMinutes: 750 }] },
      { employeeId: "empB" as unknown as EmployeeId, date: DATE, segments: [{ startMinutes: 750, endMinutes: 990 }] },
    ],
  }
}

/** empA 06:00–12:15, empB 12:30–16:30 : un trou de 15 minutes à 12:15. */
function holedSolution(problem: PlanningProblemV3): PlanningSolutionV3 {
  return {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprintProblem(problem),
    assignments: [
      { employeeId: "empA" as unknown as EmployeeId, date: DATE, segments: [{ startMinutes: 360, endMinutes: 735 }] },
      { employeeId: "empB" as unknown as EmployeeId, date: DATE, segments: [{ startMinutes: 750, endMinutes: 990 }] },
    ],
  }
}

const CONTINUOUS_WINDOW = { id: "req", date: DATE, startMinutes: 360, endMinutes: 990 }

describe("validateur V3 — plancher de couverture incassable", () => {
  it("sans le champ, la validation est strictement inchangée", () => {
    // Le créneau demande 2 personnes en continu et n'en obtient qu'une. Sans
    // plancher déclaré, cela reste une dégradation : rien ne bloque.
    const problem = problemWith({ ...CONTINUOUS_WINDOW, requiredEmployees: 2, maximumEmployees: null })
    const report = validatePlanningSolutionV3(problem, relaySolution(problem))

    expect(report.validHardConstraints).toBe(true)
    expect(report.violations).toEqual([])
    expect(report.underCoveredSlots).toBe(1)
    expect(report.degradations.some((v) => v.rule === "coverage-deficit")).toBe(true)
  })

  it("un plancher satisfait ne produit aucune violation", () => {
    const problem = problemWith({
      ...CONTINUOUS_WINDOW,
      requiredEmployees: 2,
      hardMinimumEmployees: 1,
      maximumEmployees: null,
    })
    const report = validatePlanningSolutionV3(problem, relaySolution(problem))

    expect(report.validHardConstraints).toBe(true)
    expect(report.violations.some((v) => v.rule === "hard-coverage-floor")).toBe(false)
    // La cible souple reste manquée, et reste une dégradation.
    expect(report.degradations.some((v) => v.rule === "coverage-deficit")).toBe(true)
  })

  it("un plancher enfoncé est BLOQUANT, pas une dégradation", () => {
    const problem = problemWith({
      ...CONTINUOUS_WINDOW,
      requiredEmployees: 2,
      hardMinimumEmployees: 2,
      maximumEmployees: null,
    })
    const report = validatePlanningSolutionV3(problem, relaySolution(problem))

    expect(report.validHardConstraints).toBe(false)
    const violation = report.violations.find((v) => v.rule === "hard-coverage-floor")
    expect(violation?.severity).toBe("blocking")
    expect(violation?.expected).toBe(2)
    expect(violation?.actual).toBe(1)
    // Le plancher n'est PAS rangé parmi les dégradations : il n'est pas un
    // déficit qu'on accepte, il est un refus de publication.
    expect(report.degradations.some((v) => v.rule === "hard-coverage-floor")).toBe(false)
  })

  it("un trou de quinze minutes suffit à enfoncer un plancher de 1", () => {
    const problem = problemWith({
      ...CONTINUOUS_WINDOW,
      requiredEmployees: 1,
      hardMinimumEmployees: 1,
      maximumEmployees: null,
    })
    const report = validatePlanningSolutionV3(problem, holedSolution(problem))

    // La présence minimale sur la fenêtre est 0 : la continuité est rompue.
    expect(report.validHardConstraints).toBe(false)
    const violation = report.violations.find((v) => v.rule === "hard-coverage-floor")
    expect(violation?.actual).toBe(0)
    expect(violation?.message).toContain("plancher incassable de 1")
  })

  it("un plancher de zéro est une déclaration, pas une absence, et ne bloque jamais", () => {
    const problem = problemWith({
      ...CONTINUOUS_WINDOW,
      requiredEmployees: 2,
      hardMinimumEmployees: 0,
      maximumEmployees: null,
    })
    const report = validatePlanningSolutionV3(problem, holedSolution(problem))

    expect(report.violations.some((v) => v.rule === "hard-coverage-floor")).toBe(false)
  })
})
