import type { Assignment, Employee } from "@/features/core/models"

import { constraintEvaluator } from "@/features/core/constraint-engine"
import type { Coverage } from "@/features/core/demand-engine"
import type {
  GenerationContext,
  GenerationPlan,
  GenerationStatistics,
  GenerationStrategy,
  PlanningGenerationInput,
  PlanningGenerationResult,
} from "@/features/core/planning-generator/types"
import { buildEmptyPlanning } from "@/features/core/planning-generator/builders"
import { businessPipelineStrategy } from "@/features/core/planning-generator/strategies"
import { evaluatePlanning } from "@/features/core/planning-generator/generator/evaluation-pipeline"

/** Optional overrides for a generation run. */
export interface GenerationOptions {
  /** The assignment algorithm. Defaults to the sequential strategy. */
  readonly strategy?: GenerationStrategy
}

/**
 * PlanningGenerator — produces a first valid planning by ORCHESTRATING the
 * existing core engines. It owns no business rule, no optimization and no search:
 * it prepares the problem, delegates assignment to a pluggable strategy, then
 * runs the evaluation pipeline and bundles every engine's report.
 */
export interface PlanningGenerator {
  generate(
    input: PlanningGenerationInput,
    options?: GenerationOptions
  ): PlanningGenerationResult
}

export const planningGenerator: PlanningGenerator = {
  generate(
    input: PlanningGenerationInput,
    options: GenerationOptions = {}
  ): PlanningGenerationResult {
    const strategy = options.strategy ?? businessPipelineStrategy
    const planning = buildEmptyPlanning(input.store.id, input.settings)

    const context: GenerationContext = {
      store: input.store,
      employees: input.employees,
      demand: input.demand,
      settings: input.settings,
      planning,
      registry: input.registry,
      evaluator: constraintEvaluator,
      contracts: input.contracts ?? [],
      availabilityRules: input.availabilityRules ?? [],
      absences: input.absences ?? [],
      holidays: input.holidays ?? [],
      employeeConstraints: input.employeeConstraints ?? [],
      business: input.business ?? {},
    }

    const plan = strategy.generate(context)
    const evaluation = evaluatePlanning(context, plan.shifts, plan.assignments)

    return {
      planning,
      shifts: plan.shifts,
      assignments: plan.assignments,
      constraintReport: evaluation.constraintReport,
      coverage: evaluation.coverage,
      fairness: evaluation.fairness,
      score: evaluation.score,
      statistics: buildGenerationStatistics(strategy, input.employees, plan, evaluation.coverage),
      assignmentRankings: plan.assignmentRankings,
      status: plan.issues?.some((issue) => issue.severity === "blocking")
        ? "blocked"
        : plan.issues?.some((issue) => issue.severity === "degradation")
          ? "degraded"
          : "complete",
      explanations: plan.explanations ?? [],
      issues: plan.issues ?? [],
      phaseTrace: plan.phaseTrace ?? [],
      repairAttempts: plan.repairAttempts ?? [],
      weeklyAllocation: plan.weeklyAllocation ?? null,
    }
  },
}

/**
 * Assemble the generation statistics from the strategy's counters and the
 * coverage report. Nothing is recomputed: coverage figures come straight from
 * the demand engine's per-requirement results.
 */
function buildGenerationStatistics(
  strategy: GenerationStrategy,
  employees: readonly Employee[],
  plan: GenerationPlan,
  coverage: Coverage
): GenerationStatistics {
  let fully = 0
  let partial = 0
  let uncovered = 0
  for (const result of coverage.results) {
    if (result.status === "covered" || result.status === "over_covered") fully += 1
    else if (result.assignedCount > 0) partial += 1
    else uncovered += 1
  }

  const assignedEmployees = new Set<Assignment["employeeId"]>(
    plan.assignments.map((assignment) => assignment.employeeId)
  )

  return {
    strategy: strategy.name,
    requirementsTotal: coverage.results.length,
    requirementsFullyCovered: fully,
    requirementsPartiallyCovered: partial,
    requirementsUncovered: uncovered,
    shiftsCreated: plan.shifts.length,
    assignmentsCreated: plan.assignments.length,
    employeesConsidered: employees.filter((employee) => employee.status === "active").length,
    employeesAssigned: assignedEmployees.size,
    candidatesRejectedByHardConstraints: plan.candidatesRejectedByHardConstraints,
    constraintEvaluations: plan.constraintEvaluations,
  }
}
