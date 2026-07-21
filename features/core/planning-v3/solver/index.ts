import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { PLANNING_PROBLEM_V3_VERSION } from "@/features/core/planning-v3/types/problem"
import type {
  PlanningAssignmentV3,
  PlanningSolutionV3,
} from "@/features/core/planning-v3/types/solution"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import type {
  PlanningSolverOptionsV3,
  PlanningSolverResultV3,
  PlanningSolverStatisticsV3,
} from "@/features/core/planning-v3/types/solver"
import type { PlanningInfeasibilityV3 } from "@/features/core/planning-v3/types/validation"
import { fingerprintProblem } from "@/features/core/planning-v3/validator/fingerprint"

import { generateCandidateSpace } from "@/features/core/planning-v3/solver/candidate-generator/generate-candidates"
import { buildSolverModel } from "@/features/core/planning-v3/solver/daily-patterns/day-model"
import { diagnoseInfeasibility } from "@/features/core/planning-v3/solver/diagnostics/diagnose"
import { searchWeek } from "@/features/core/planning-v3/solver/weekly-search/search"

export { generateCandidateSpace } from "@/features/core/planning-v3/solver/candidate-generator/generate-candidates"
export type {
  CandidateSpaceV3,
  SolverCandidateV3,
} from "@/features/core/planning-v3/solver/candidate-generator/generate-candidates"
export { buildSolverModel } from "@/features/core/planning-v3/solver/daily-patterns/day-model"
export {
  compareObjective,
  OBJECTIVE_COMPONENTS,
} from "@/features/core/planning-v3/solver/objective/objective"
export { diagnoseInfeasibility } from "@/features/core/planning-v3/solver/diagnostics/diagnose"

/**
 * The Planning V3 weekly solver.
 *
 * It chooses shifts across the WHOLE period at once rather than day after day,
 * because the binding constraints are weekly: a contract that must land exactly
 * on its minutes, a rest that couples one evening to the next morning, and
 * opening/closing caps counted over the week. A day-by-day engine cannot see
 * any of them, which is precisely why the V2 pipeline needed repair passes.
 *
 * There is NO fallback to V2 anywhere in this file. A problem that cannot be
 * solved returns `infeasible` with diagnostics, or `feasible-timeout` with the
 * best legal schedule found — never a schedule from another engine.
 */
export function solvePlanningProblemV3(
  problem: PlanningProblemV3,
  options: PlanningSolverOptionsV3 = {}
): PlanningSolverResultV3 {
  const startedAt = Date.now()

  const malformed = validateProblemShape(problem)
  if (malformed.length > 0) {
    return {
      status: "invalid-problem",
      solution: null,
      objective: null,
      proof: {
        kind: "none",
        objectiveValues: [],
        note: "Problème malformé : aucune recherche n'a été lancée.",
        candidateSpace: "incomplete",
        stopCause: "invalid-problem",
        deterministic: true,
        splitShiftsSupported: false,
      },
      statistics: emptyStatistics(Date.now() - startedAt),
      diagnostics: malformed,
    }
  }

  const space = generateCandidateSpace(problem)
  const model = buildSolverModel(problem, space)
  const structural = diagnoseInfeasibility(problem, space, model)
  if (structural.length > 0) {
    return {
      status: "infeasible",
      solution: null,
      objective: null,
      proof: {
        kind: "none",
        objectiveValues: [],
        note: "Infaisabilité démontrée avant recherche par des conditions nécessaires.",
        candidateSpace: space.splitShiftsEnumerated ? "complete" : "incomplete",
        candidatesGenerated: space.totalCandidates,
        stopCause: "structurally-infeasible",
        deterministic: true,
        splitShiftsSupported: false,
      },
      statistics: emptyStatistics(Date.now() - startedAt, space.totalCandidates),
      diagnostics: structural,
    }
  }

  const outcome = searchWeek(problem, space, model, options)
  const durationMs = Date.now() - startedAt
  const exhausted = outcome.stopCause === "exhausted"

  const statistics: PlanningSolverStatisticsV3 = {
    candidatesGenerated: space.totalCandidates,
    dailyPatternsEvaluated: outcome.dailyPatternsEvaluated,
    weeklyStatesEvaluated: outcome.statesEvaluated,
    branchesPrunedByBound: outcome.prunedByBound,
    branchesPrunedByFeasibility: outcome.prunedByFeasibility,
    durationMs,
    peakOpenNodes: outcome.peakDepth,
  }

  if (outcome.assignments === null || outcome.objective === null) {
    return {
      status: exhausted ? "infeasible" : "feasible-timeout",
      solution: null,
      objective: null,
      proof: {
        kind: "none",
        objectiveValues: [],
        note: exhausted
          ? "Espace déclaré entièrement exploré sans aucune solution légale."
          : `Recherche interrompue (${outcome.stopCause}) avant toute solution légale ; l'infaisabilité n'est PAS démontrée.`,
        candidateSpace: space.splitShiftsEnumerated ? "complete" : "incomplete",
        candidatesGenerated: space.totalCandidates,
        dailyPatternsEvaluated: outcome.dailyPatternsEvaluated,
        weeklyStatesEvaluated: outcome.statesEvaluated,
        branchesPrunedByBound: outcome.prunedByBound,
        durationMs,
        lowerBound: null,
        stopCause: outcome.stopCause,
        deterministic: true,
        splitShiftsSupported: false,
      },
      statistics,
      diagnostics: exhausted
        ? [
            {
              code: "search_exhausted_without_solution",
              message:
                "Aucune combinaison légale n'existe dans l'espace des shifts continus pour ce problème.",
            },
          ]
        : [],
    }
  }

  const solution = toSolution(problem, outcome.assignments)

  // `optimal` demands ALL of: the space was exhausted, no declared limit was
  // hit, and the enumerated space is complete for the announced rules. Split
  // shifts are not enumerated in V3B, so a problem that allows them can never
  // be declared optimal here.
  const spaceComplete = space.splitShiftsEnumerated || !problem.rules.splitShiftAllowed
  const optimal = exhausted && spaceComplete

  return {
    status: optimal ? "optimal" : "feasible-timeout",
    solution,
    objective: outcome.objective,
    proof: {
      kind: optimal ? "optimal" : "feasible",
      objectiveValues: outcome.objective,
      note: optimal
        ? "Espace des shifts continus entièrement exploré ou éliminé par bornes sûres : optimum démontré pour ces règles."
        : exhausted
          ? "Espace des shifts continus entièrement exploré, mais les coupures ne sont pas énumérées : optimum NON démontré."
          : `Recherche interrompue (${outcome.stopCause}) : meilleure solution légale trouvée, optimalité NON démontrée.`,
      candidateSpace: spaceComplete ? "complete" : "incomplete",
      candidatesGenerated: space.totalCandidates,
      dailyPatternsEvaluated: outcome.dailyPatternsEvaluated,
      weeklyStatesEvaluated: outcome.statesEvaluated,
      branchesPrunedByBound: outcome.prunedByBound,
      durationMs,
      bestObjective: outcome.objective,
      lowerBound: optimal ? outcome.objective : null,
      stopCause: outcome.stopCause,
      deterministic: true,
      splitShiftsSupported: false,
    },
    statistics,
    diagnostics: spaceComplete
      ? []
      : [
          {
            code: "candidate-space-incomplete",
            message:
              "Les coupures sont autorisées par le secteur mais ne sont pas énumérées en V3B : les shifts continus retournés restent légaux, mais aucun optimum global ne peut être annoncé.",
          },
        ],
  }
}

function toSolution(
  problem: PlanningProblemV3,
  candidates: readonly { employeeId: PlanningAssignmentV3["employeeId"]; date: string; startMinutes: number; endMinutes: number; isRest: boolean }[]
): PlanningSolutionV3 {
  const assignments: PlanningAssignmentV3[] = candidates
    .filter((candidate) => !candidate.isRest)
    .map((candidate) => ({
      employeeId: candidate.employeeId,
      date: candidate.date,
      segments: [{ startMinutes: candidate.startMinutes, endMinutes: candidate.endMinutes }],
    }))
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        String(left.employeeId).localeCompare(String(right.employeeId))
    )

  return {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint: fingerprintProblem(problem),
    assignments,
  }
}

function validateProblemShape(problem: PlanningProblemV3): PlanningInfeasibilityV3[] {
  const errors: PlanningInfeasibilityV3[] = []
  if (problem.version !== PLANNING_PROBLEM_V3_VERSION) {
    errors.push({
      code: "unsupported_problem_version",
      message: `Version de problème ${problem.version} non prise en charge par ce solveur (${PLANNING_PROBLEM_V3_VERSION}).`,
    })
  }
  if (problem.employees.length === 0) {
    errors.push({ code: "no_employee", message: "Le problème ne contient aucun salarié." })
  }
  if (problem.days.length === 0) {
    errors.push({ code: "no_day", message: "Le problème ne contient aucun jour." })
  }
  if (problem.timeStepMinutes <= 0) {
    errors.push({ code: "invalid_time_step", message: "Le pas de temps doit être positif." })
  }
  if (problem.rules.minimumShiftMinutes > problem.rules.maximumShiftMinutes) {
    errors.push({
      code: "inverted_shift_bounds",
      message: `Durée minimale ${problem.rules.minimumShiftMinutes} supérieure à la durée maximale ${problem.rules.maximumShiftMinutes}.`,
    })
  }
  return errors
}

function emptyStatistics(durationMs: number, candidatesGenerated = 0): PlanningSolverStatisticsV3 {
  return {
    candidatesGenerated,
    dailyPatternsEvaluated: 0,
    weeklyStatesEvaluated: 0,
    branchesPrunedByBound: 0,
    branchesPrunedByFeasibility: 0,
    durationMs,
    peakOpenNodes: 0,
  }
}
