import { describe, expect, it } from "vitest"

import type { EmployeeId, WeekDay } from "@/features/core/models"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type {
  PlanningRuleCodeV3,
  PlanningValidationReportV3,
} from "@/features/core/planning-v3/types/validation"
import { fingerprintProblem } from "@/features/core/planning-v3/validator"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

import {
  REFERENCE_DATES,
  referenceInput,
  referenceSolution,
  withDay,
} from "@/features/core/planning-v3/__tests__/reference-scenario"

/**
 * Mutation tests for the independent validator.
 *
 * Each case starts from a solution that is legal on every rule at once, breaks
 * exactly one thing, and asserts the validator reports the rule that thing
 * belongs to. Where a corruption cannot help but disturb a coupled invariant —
 * you cannot shorten a shift without the minutes going somewhere — the coupled
 * rules are listed explicitly, so the expected rule SET is pinned either way
 * and no violation can appear or disappear unnoticed.
 */

const [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY] = REFERENCE_DATES

function problemOf(mutate?: (input: ReturnType<typeof referenceInput>) => void): PlanningProblemV3 {
  const input = referenceInput()
  mutate?.(input)
  const built = buildPlanningProblemV3(input)
  if (!built.ok) throw new Error(`Problème V3 invalide : ${built.errors.map((e) => e.message).join(" | ")}`)
  return built.problem
}

function validate(problem: PlanningProblemV3, solution: PlanningSolutionV3) {
  return validatePlanningSolutionV3(problem, solution)
}

/** The distinct rules a report flags as blocking, sorted for stable comparison. */
function brokenRules(report: PlanningValidationReportV3): PlanningRuleCodeV3[] {
  return [...new Set(report.violations.map((violation) => violation.rule))].sort()
}

function seg(startMinutes: number, endMinutes: number) {
  return [{ startMinutes, endMinutes }]
}

describe("validateur V3 — solution de référence", () => {
  const problem = problemOf()
  const baseline = referenceSolution(fingerprintProblem(problem))

  it("valide une solution légale sans aucune violation", () => {
    const report = validate(problem, baseline)
    expect(brokenRules(report)).toEqual([])
    expect(report.validHardConstraints).toBe(true)
  })

  it("recalcule des métriques exactes", () => {
    const report = validate(problem, baseline)
    for (const employee of problem.employees) {
      const weekKey = problem.days[0].weekKey
      expect(report.metrics.weeklyMinutesByEmployeeWeek[`${String(employee.id)}|${weekKey}`]).toBe(1_800)
    }
    expect(report.metrics.dailyMinutesByDate[MONDAY]).toBe(1_080)
    expect(report.metrics.dailyMinutesByDate[FRIDAY]).toBe(1_440)
    expect(report.metrics.totalDeficitMinutes).toBe(0)
    expect(report.metrics.structuralSurplusMinutes).toBe(2_160)
    expect(report.metrics.avoidableSurplusMinutes).toBe(0)
  })

  it("n'annonce jamais d'optimalité en V3A", () => {
    expect(validate(problem, baseline).proof.kind).toBe("none")
  })

  it("n'exige aucune acceptation quand rien ne la demande", () => {
    const report = validate(problem, baseline)
    // The report always carries an informative entry; it must not gate anything.
    expect(report.informations.length).toBeGreaterThan(0)
    expect(report.informations.every((entry) => entry.requiresExplicitAcceptance !== true)).toBe(true)
    expect(report.requiresExplicitAcceptance).toBe(false)
  })

  it("dérive maximumConsecutiveWorkedDays et en expose la provenance", () => {
    // No configuration field exists, so the value is the structural maximum —
    // six open days here — and is tagged as derived, never as a real rule.
    expect(problem.rules.maximumConsecutiveWorkedDaysSource).toBe("derived-fallback")
    expect(problem.rules.maximumConsecutiveWorkedDays).toBe(6)
  })

  it("produit une empreinte déterministe et sensible au moindre changement", () => {
    expect(validate(problem, baseline).fingerprint).toBe(validate(problem, baseline).fingerprint)
    const moved = withDay(baseline, "bruno", MONDAY, seg(600, 871))
    expect(validate(problem, moved).fingerprint).not.toBe(validate(problem, baseline).fingerprint)
  })
})

describe("validateur V3 — détection des corruptions", () => {
  const problem = problemOf()
  const fingerprint = fingerprintProblem(problem)
  const baseline = referenceSolution(fingerprint)

  it("1. contrat inférieur de 15 minutes", () => {
    // Alice loses 15 minutes on Monday, Bruno picks them up: the daily budget
    // still closes, so only the weekly contracts can be wrong.
    let solution = withDay(baseline, "alice", MONDAY, seg(360, 615))
    solution = withDay(solution, "bruno", MONDAY, seg(585, 870))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["contract-minutes"])
    const alice = report.violations.find((v) => String(v.employeeId) === "alice")
    expect(alice?.actual).toBe(1_785)
    expect(alice?.expected).toBe(1_800)
  })

  it("2. contrat supérieur de 15 minutes", () => {
    let solution = withDay(baseline, "alice", MONDAY, seg(360, 645))
    solution = withDay(solution, "bruno", MONDAY, seg(600, 855))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["contract-minutes"])
    const alice = report.violations.find((v) => String(v.employeeId) === "alice")
    expect(alice?.actual).toBe(1_815)
    expect(alice?.expected).toBe(1_800)
  })

  it("3. salarié absent un jour obligatoire", () => {
    const solution = withDay(baseline, "dylan", THURSDAY, [])
    const report = validate(problem, solution)
    expect(brokenRules(report)).toContain("mandatory-day")
    const missing = report.violations.find((v) => v.rule === "mandatory-day")
    expect(String(missing?.employeeId)).toBe("dylan")
    expect(missing?.date).toBe(THURSDAY)
  })

  it("4. salarié présent un jour de repos fixe", () => {
    // Same legal schedule, but Chloé now has Wednesday as a fixed rest day.
    const withRest = problemOf((input) => {
      const constraints = [
        ...(input.employeeConstraints ?? []),
        {
          id: "fixed_off_chloe" as never,
          employeeId: "chloe" as unknown as EmployeeId,
          type: "FIXED_DAY_OFF" as const,
          day: "wednesday" as WeekDay,
        },
      ]
      ;(input as { employeeConstraints: unknown }).employeeConstraints = constraints
    })
    const report = validate(withRest, referenceSolution(fingerprintProblem(withRest)))
    expect(brokenRules(report)).toEqual(["fixed-rest-day"])
    expect(String(report.violations[0].employeeId)).toBe("chloe")
    expect(report.violations[0].date).toBe(WEDNESDAY)
  })

  it("5. shift de moins de 4 heures", () => {
    // Bruno drops to 180 minutes on Monday; Chloé and Dylan absorb the minutes
    // that day, and Tuesday hands them back, so budgets and contracts hold.
    let solution = withDay(baseline, "bruno", MONDAY, seg(600, 780))
    solution = withDay(solution, "chloe", MONDAY, seg(780, 1_110))
    solution = withDay(solution, "dylan", MONDAY, seg(900, 1_200))
    solution = withDay(solution, "bruno", TUESDAY, seg(600, 960))
    solution = withDay(solution, "chloe", TUESDAY, seg(840, 1_050))
    solution = withDay(solution, "dylan", TUESDAY, seg(960, 1_200))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["minimum-shift"])
    expect(report.violations.some((v) => String(v.employeeId) === "bruno" && v.actual === 180)).toBe(true)
  })

  it("6. shift supérieur à 10 heures", () => {
    // Chloé works 660 minutes on Friday; her colleagues give the minutes back
    // the same day so the budget still closes.
    let solution = withDay(baseline, "chloe", FRIDAY, seg(360, 1_020))
    solution = withDay(solution, "dylan", FRIDAY, seg(540, 780))
    solution = withDay(solution, "alice", FRIDAY, seg(960, 1_200))
    solution = withDay(solution, "bruno", FRIDAY, seg(780, 1_080))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toContain("maximum-shift")
    const excess = report.violations.find((v) => v.rule === "maximum-shift")
    expect(excess?.actual).toBe(660)
    expect(excess?.expected).toBe(600)
  })

  it("7. repos de seulement 10 heures", () => {
    // Alice closes Friday at 20:00 then opens Saturday at 06:00 — the shortest
    // gap the opening hours allow, and 120 minutes below the legal rest.
    let solution = withDay(baseline, "alice", SATURDAY, seg(360, 720))
    solution = withDay(solution, "chloe", SATURDAY, seg(840, 1_200))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["minimum-rest"])
    const rest = report.violations[0]
    expect(rest.actual).toBe(600)
    expect(rest.expected).toBe(720)
    expect(String(rest.employeeId)).toBe("alice")
  })

  it("8. Dylan placé en ouverture", () => {
    // Dylan and Chloé swap Saturday roles. Dylan has no CAN_OPEN, and his
    // Friday finishes early enough that the rest rule stays satisfied.
    let solution = withDay(baseline, "dylan", SATURDAY, seg(360, 720))
    solution = withDay(solution, "chloe", SATURDAY, seg(780, 1_140))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["opening-capability"])
    expect(String(report.violations[0].employeeId)).toBe("dylan")
    expect(report.violations[0].date).toBe(SATURDAY)
  })

  it("9. dépassement du nombre de fermetures", () => {
    // Dylan takes Chloé's Wednesday closing: a third closing for a cap of two.
    let solution = withDay(baseline, "dylan", WEDNESDAY, seg(930, 1_200))
    solution = withDay(solution, "chloe", WEDNESDAY, seg(840, 1_110))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["maximum-closings"])
    expect(String(report.violations[0].employeeId)).toBe("dylan")
    expect(report.violations[0].actual).toBe(3)
    expect(report.violations[0].expected).toBe(2)
  })

  it("10. fermeture excédentaire", () => {
    // Chloé now also finishes at 20:00 on Monday, so the day has two closers
    // where the rules call for exactly one.
    const solution = withDay(baseline, "chloe", MONDAY, seg(840, 1_200))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toContain("closing-count")
    const count = report.violations.find((v) => v.rule === "closing-count")
    expect(count?.date).toBe(MONDAY)
    expect(count?.actual).toBe(2)
    expect(count?.expected).toBe(1)
  })

  it("11. budget du mardi supérieur de 15 minutes", () => {
    // Alice moves 15 minutes from Wednesday to Tuesday: her contract still
    // closes, so only the two daily budgets can be wrong.
    let solution = withDay(baseline, "alice", TUESDAY, seg(360, 645))
    solution = withDay(solution, "alice", WEDNESDAY, seg(600, 855))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["daily-budget"])
    const tuesday = report.violations.find((v) => v.date === TUESDAY)
    expect(tuesday?.actual).toBe(1_095)
    expect(tuesday?.expected).toBe(1_080)
  })

  it("12. budget du vendredi inférieur de 15 minutes", () => {
    let solution = withDay(baseline, "alice", FRIDAY, seg(855, 1_200))
    solution = withDay(solution, "alice", SATURDAY, seg(825, 1_200))
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["daily-budget"])
    const friday = report.violations.find((v) => v.date === FRIDAY)
    expect(friday?.actual).toBe(1_425)
    expect(friday?.expected).toBe(1_440)
  })

  it("13. déficit de couverture samedi à 06:00", () => {
    // Chloé starts an hour late on Saturday, leaving 06:00–07:00 uncovered.
    // A shortfall is a DEGRADATION: the schedule stays legal, but it may not be
    // published until someone knowingly accepts the gap.
    const solution = withDay(baseline, "chloe", SATURDAY, seg(420, 780))
    const report = validate(problem, solution)

    const deficit = report.degradations.find((v) => v.rule === "coverage-deficit")
    expect(deficit).toBeDefined()
    expect(deficit?.severity).toBe("degradation")
    expect(deficit?.date).toBe(SATURDAY)
    expect(deficit?.actual).toBe(0)
    expect(deficit?.expected).toBe(1)
    expect(report.underCoveredSlots).toBe(1)
    // The shortfall is what asks for a decision — not the mere presence of a
    // degradation in the report.
    expect(deficit?.requiresExplicitAcceptance).toBe(true)
    expect(report.requiresExplicitAcceptance).toBe(true)

    // The shortfall alone never blocks: the only blocking rule here is the
    // missing opener, which is a genuine hard-constraint breach.
    expect(brokenRules(report)).not.toContain("coverage-deficit")
    expect(brokenRules(report)).toEqual(["opening-count"])
  })


  it("14. mauvais calcul du surplus structurel", () => {
    // The generator commits to a figure; the validator recomputes it and
    // refuses to take its word for it.
    const solution: PlanningSolutionV3 = {
      ...baseline,
      declaredMetrics: { structuralSurplusMinutes: 2_175 },
    }
    const report = validate(problem, solution)
    expect(brokenRules(report)).toEqual(["declared-metrics"])
    expect(report.violations[0].actual).toBe(2_175)
    expect(report.violations[0].expected).toBe(2_160)
  })
})
