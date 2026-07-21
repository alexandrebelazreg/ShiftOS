import type { Assignment, Shift } from "@/features/core/models"

import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"
import type { Coverage } from "@/features/core/demand-engine"
import { coverageCalculator } from "@/features/core/demand-engine"
import type { FairnessReport } from "@/features/core/fairness-engine"
import { fairnessEngine } from "@/features/core/fairness-engine"
import type { PlanningScore } from "@/features/core/scoring-engine"
import { scoringEngine } from "@/features/core/scoring-engine"
import type { StatisticsCalendar } from "@/features/core/statistics-engine"
import { statisticsService } from "@/features/core/statistics-engine"
import type { GenerationContext } from "@/features/core/planning-generator/types"
import { buildConstraintContext } from "@/features/core/planning-generator/builders"

/** The four engine reports produced for a generated planning. */
export interface EvaluationResult {
  readonly constraintReport: ConstraintEvaluationReport
  readonly coverage: Coverage
  readonly fairness: FairnessReport
  readonly score: PlanningScore
}

/**
 * Run the evaluation pipeline on a generated planning, in the mandated order:
 *
 *   Constraint Engine → Coverage (Demand Engine) → Fairness Engine → Scoring Engine
 *
 * Pure orchestration: every figure is produced by the engine that owns it. The
 * generator computes nothing itself — it only feeds each engine the previous
 * outputs (the score consumes the constraint report AND the coverage).
 */
export function evaluatePlanning(
  context: GenerationContext,
  shifts: readonly Shift[],
  assignments: readonly Assignment[]
): EvaluationResult {
  const { registry, evaluator, demand, employees, store, planning, settings } = context

  // 1. Constraint Engine — feasibility + violations.
  const constraintReport = evaluator.evaluate(
    registry,
    buildConstraintContext(context, shifts, assignments)
  )

  // 2. Demand Engine — coverage of the demand by the assignments.
  const coverage = coverageCalculator.calculate({ demand, assignments, shifts, employees })

  // 3. Statistics Engine — the single source of per-employee facts. The
  //    generator computes NO statistics itself; it reads them from this engine.
  const calendar: StatisticsCalendar = {
    holidays: context.holidays,
    absences: context.absences,
  }
  const statistics = statisticsService.computeEmployeeStatistics({
    planning,
    employees,
    assignments,
    shifts,
    store,
    calendar,
    coverage,
  })

  // 4. Fairness Engine — distribution equity (consumes the statistics above).
  const fairness = fairnessEngine.analyze(
    { planning, employees, assignments, statistics },
    settings.fairnessPolicy ? { policy: settings.fairnessPolicy } : undefined
  )

  // 5. Scoring Engine — the comparable score (consumes report + coverage).
  const score = scoringEngine.score({ report: constraintReport, coverage }, settings.scoringPolicy)

  return { constraintReport, coverage, fairness, score }
}
