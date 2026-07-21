import type { EmployeeId } from "@/features/core/models"
import { contractualMinutes } from "@/features/core/models"

import { constraintEvaluator } from "@/features/core/constraint-engine"
import type { ConstraintEvaluationReport } from "@/features/core/constraint-engine"
import type { Coverage } from "@/features/core/demand-engine"
import type { FairnessReport } from "@/features/core/fairness-engine"
import type { PlanningScore } from "@/features/core/scoring-engine"
import type { StatisticsReport } from "@/features/core/statistics-engine"
import { statisticsService } from "@/features/core/statistics-engine"
import type { GenerationContext } from "@/features/core/planning-generator"
import { evaluatePlanning } from "@/features/core/planning-generator"
import { storeConfigurationService } from "@/features/store/services/store-configuration-service"

import type { EditorState } from "@/features/planning/editor/editor-state"
import type { WarningLevel } from "@/features/planning/editor/warning-levels"
import { blocks, planningLevel } from "@/features/planning/editor/warning-levels"

/** Live headline indicators, all in `[0, 1]` except `constraintStatus`. */
export interface LiveIndicators {
  readonly quality: number
  readonly coverage: number
  readonly fairness: number
  readonly contractCompliance: number
  readonly constraintStatus: "feasible" | "infeasible"
}

/** The complete live evaluation of the current planning. */
export interface EditorEvaluation {
  readonly constraintReport: ConstraintEvaluationReport
  readonly coverage: Coverage
  readonly fairness: FairnessReport
  readonly score: PlanningScore
  readonly statistics: StatisticsReport
  readonly level: WarningLevel
  readonly indicators: LiveIndicators
  readonly canPublish: boolean
  /** Employees named in at least one HARD violation (for per-employee status). */
  readonly employeesWithHardViolation: ReadonlySet<EmployeeId>
}

/**
 * Re-evaluate the current planning by REUSING the generator's evaluation
 * pipeline (`evaluatePlanning` = constraint → coverage → fairness → scoring) and
 * the statistics engine. Nothing is recomputed by the editor; it only reads the
 * engines' reports and derives the editor-level warning state.
 *
 * This is the single function every edit re-runs, so all views and indicators
 * stay consistent with one source of truth.
 */
export function evaluateEditor(state: EditorState): EditorEvaluation {
  const { coreInput, planning, settings } = state
  const registry = storeConfigurationService.toConstraintRegistry(state.configuration)

  const context: GenerationContext = {
    store: coreInput.store,
    employees: coreInput.employees,
    demand: coreInput.demand,
    settings,
    planning,
    registry,
    evaluator: constraintEvaluator,
    contracts: coreInput.contracts,
    availabilityRules: coreInput.availabilityRules,
    absences: coreInput.absences,
    holidays: coreInput.holidays,
    employeeConstraints: coreInput.employeeConstraints,
    business: {},
  }

  const evaluation = evaluatePlanning(context, state.shifts, state.assignments)
  const statistics = statisticsService.compute({
    planning,
    employees: coreInput.employees,
    assignments: state.assignments,
    shifts: state.shifts,
    store: coreInput.store,
    calendar: { holidays: coreInput.holidays, absences: coreInput.absences },
    coverage: evaluation.coverage,
  })

  const { constraintReport, coverage, fairness, score } = evaluation

  const employeesWithHardViolation = new Set<EmployeeId>()
  for (const violation of constraintReport.hardViolations) {
    for (const ref of violation.affected ?? []) {
      if (ref.type === "employee") employeesWithHardViolation.add(ref.id)
    }
  }

  const softWarnings = score.warnings.length + fairness.warnings.length
  const level = planningLevel({
    hardViolations: constraintReport.score.hardViolationCount,
    missingCapabilities: coverage.statistics.requirementsWithMissingCapabilities,
    underCoveredRequirements: coverage.statistics.underCovered,
    softWarnings,
  })

  return {
    constraintReport,
    coverage,
    fairness,
    score,
    statistics,
    level,
    indicators: {
      quality: score.overall,
      coverage: coverage.statistics.overallCoveragePercentage,
      fairness: fairness.overall,
      contractCompliance: contractCompliance(state, statistics),
      constraintStatus: constraintReport.feasible ? "feasible" : "infeasible",
    },
    canPublish: !blocks(level),
    employeesWithHardViolation,
  }
}

/** Share of contracted employees whose planned hours stay within their contract. */
function contractCompliance(state: EditorState, statistics: StatisticsReport): number {
  const contractMinutes = new Map(
    state.coreInput.contracts.map((c) => [c.employeeId, contractualMinutes(c)])
  )
  let considered = 0
  let compliant = 0
  for (const stat of statistics.employees) {
    const contract = contractMinutes.get(stat.employeeId)
    if (contract === undefined || contract <= 0) continue
    considered += 1
    if (stat.workedMinutes <= contract) compliant += 1
  }
  return considered > 0 ? compliant / considered : 1
}
