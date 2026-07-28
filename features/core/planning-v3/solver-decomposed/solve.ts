import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type {
  PlanningAssignmentV3,
  PlanningSolutionV3,
} from "@/features/core/planning-v3/types/solution"
import { PLANNING_SOLUTION_V3_VERSION } from "@/features/core/planning-v3/types/solution"
import type {
  PlanningSolverResultV3,
  PlanningSolverStatisticsV3,
} from "@/features/core/planning-v3/types/solver"
import type { PlanningInfeasibilityV3 } from "@/features/core/planning-v3/types/validation"
import {
  fingerprintProblem,
  fingerprintSolution,
} from "@/features/core/planning-v3/validator/fingerprint"

import { generateAllocations } from "@/features/core/planning-v3/solver-decomposed/allocation/allocate"
import { generateReducedCandidates } from "@/features/core/planning-v3/solver-decomposed/candidate-generator/generate"
import { normaliseProblem } from "@/features/core/planning-v3/solver-decomposed/diagnostics/normalise"
import type { DecomposedObjective } from "@/features/core/planning-v3/solver-decomposed/objective/objective"
import { compareObjective, describeObjective } from "@/features/core/planning-v3/solver-decomposed/objective/objective"
import { placeWeek } from "@/features/core/planning-v3/solver-decomposed/placement/place"
import { repairLocally } from "@/features/core/planning-v3/solver-decomposed/repair/repair"
import { selectSkeletons } from "@/features/core/planning-v3/solver-decomposed/skeleton/build-skeleton"
import type {
  Allocation,
  DecomposedOptions,
  DecomposedPhase,
  DecomposedResolvedOptions,
  DecomposedStopCause,
  ReducedCandidate,
  Skeleton,
} from "@/features/core/planning-v3/solver-decomposed/types"

/**
 * The decomposed Planning V3 engine.
 *
 * Six phases, run in order, each one narrowing what the next has to decide:
 * normalise and prove what is impossible, allocate the minutes, fix the weekly
 * skeleton, generate only plausible shapes, place the exact hours, then repair
 * locally. The point of the decomposition is arithmetic — once Phase 2 has
 * fixed the durations, Phase 4 stops enumerating them, and a candidate space
 * measured in tens of thousands becomes one measured in hundreds.
 *
 * Three commitments hold everywhere in this file.
 *
 * NO FALLBACK. A problem this engine cannot solve returns `infeasible` or a
 * declared stop with diagnostics. It never reaches for V2, never reaches for
 * CP-SAT, and never returns a schedule produced by anything but itself.
 *
 * NO OPTIMALITY. `proof.kind` is `"none"`, always. The engine keeps only the
 * best few patterns of each day and only the first few allocations, so its
 * search space is a deliberate subset of the legal one. A good answer to a
 * smaller question is not an optimum, and this file never says otherwise.
 *
 * NO SELF-VALIDATION. Nothing here imports the validator — only
 * `fingerprintProblem`, which is a pure hash and decides nothing. Whether the
 * schedule is legal is the orchestrator's question to ask of an independent
 * party, and an engine that graded its own homework is exactly the failure V3
 * exists to remove.
 */

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAXIMUM_ALLOCATIONS = 40
const DEFAULT_MAXIMUM_PLACEMENT_NODES = 4_000_000
const DEFAULT_ASSUMED_MINIMUM_SPLIT_MINUTES = 45
/**
 * Skeletons placed per allocation.
 *
 * Raised from 6 when Phase 3 gained a predictive score. Six was the right
 * number while skeletons arrived in fairness order — six variants of one greedy
 * walk are six near-identical schedules, and paying to place them all bought
 * nothing. Now that candidates come from several families and are ranked by the
 * deficit they have already made unavoidable, the first few are genuinely
 * different and genuinely the best ones known.
 */
const SKELETONS_PER_ALLOCATION = 6
/**
 * Nodes ONE placement may spend before it is cut and the next candidate
 * skeleton gets its turn.
 *
 * Without this the first skeleton spends the entire budget: measured on the
 * Drive week, one skeleton consumed all four million nodes, so exactly one
 * allocation and one skeleton were ever examined. Breadth beats depth here —
 * the schedules that differ meaningfully differ in their ALLOCATION, not in the
 * thousandth branch of one weekly walk — so the budget is sliced rather than
 * spent in order.
 */
const NODES_PER_PLACEMENT = 250_000

export interface DecomposedRunReport {
  readonly totalMs: number
  readonly phaseMs: readonly { readonly phase: DecomposedPhase; readonly durationMs: number }[]
  readonly allocationsTested: number
  readonly skeletonsTested: number
  /** Complete skeletons the families produced, before deduplication. */
  readonly skeletonsGenerated: number
  /** How many of those were genuinely distinct role assignments. */
  readonly uniqueSkeletonSignatures: number
  /** The first allocation's ranked skeletons, with their predictive scores. */
  readonly skeletonScores: readonly string[]
  readonly candidatesGenerated: number
  readonly placementNodes: number
  readonly repairsTested: number
  readonly repairsApplied: number
  readonly problemFingerprint: string
  readonly solutionFingerprint: string | null
  readonly stopCause: DecomposedStopCause
  readonly bestObjective: readonly { readonly label: string; readonly value: number }[] | null
  /** Rules the engine had to assume because the problem declared none. */
  readonly assumedRules: readonly string[]
  /** One line per skeleton tried, saying how its placement went. */
  readonly placementNotes: readonly string[]
}

export interface DecomposedRun {
  readonly result: PlanningSolverResultV3
  readonly report: DecomposedRunReport
}

export function solveDecomposed(
  problem: PlanningProblemV3,
  options: DecomposedOptions = {}
): DecomposedRun {
  const startedAt = Date.now()
  const resolved = resolveOptions(options)
  const deadline = startedAt + resolved.timeoutMs
  const budget = { nodes: resolved.maximumPlacementNodes }

  const phaseMs = new Map<DecomposedPhase, number>()
  const spend = <T>(phase: DecomposedPhase, work: () => T): T => {
    const began = Date.now()
    const value = work()
    phaseMs.set(phase, (phaseMs.get(phase) ?? 0) + (Date.now() - began))
    return value
  }

  // ── Phase 1 ───────────────────────────────────────────────────────────────
  const { normalised, malformed, structural } = spend("normalisation", () =>
    normaliseProblem(problem, resolved)
  )
  const problemFingerprint = fingerprintProblem(problem)
  const placementNotes: string[] = []

  // Declared here, above `baseReport`, because that closure reads them and an
  // early return can call it before the search loop is ever entered.
  let skeletonsGenerated = 0
  let uniqueSkeletonSignatures = 0
  const skeletonScores: string[] = []

  const baseReport = (
    stopCause: DecomposedStopCause,
    counters: Partial<DecomposedRunReport> = {}
  ): DecomposedRunReport => ({
    totalMs: Date.now() - startedAt,
    phaseMs: [...phaseMs].map(([phase, durationMs]) => ({ phase, durationMs })),
    allocationsTested: 0,
    skeletonsTested: 0,
    skeletonsGenerated,
    uniqueSkeletonSignatures,
    skeletonScores,
    candidatesGenerated: 0,
    placementNodes: 0,
    repairsTested: 0,
    repairsApplied: 0,
    problemFingerprint,
    solutionFingerprint: null,
    stopCause,
    bestObjective: null,
    assumedRules: normalised.rules.assumed,
    placementNotes,
    ...counters,
  })

  if (malformed.length > 0) {
    return {
      result: emptyResult("invalid-problem", malformed, Date.now() - startedAt, "not-started",
        "Problème malformé : aucune recherche n'a été lancée."),
      report: baseReport("not-started"),
    }
  }

  if (structural.length > 0) {
    return {
      result: emptyResult("infeasible", structural, Date.now() - startedAt, "not-started",
        "Infaisabilité démontrée avant toute recherche par des conditions nécessaires."),
      report: baseReport("not-started"),
    }
  }

  // ── Phases 2 to 5 ─────────────────────────────────────────────────────────
  let bestShifts: readonly ReducedCandidate[] | null = null
  let bestObjective: DecomposedObjective | null = null
  let allocationsTested = 0
  let skeletonsTested = 0
  let candidatesGenerated = 0
  let placementNodes = 0
  let stopCause: DecomposedStopCause = "exhausted"

  const allocations = spend("allocation", () =>
    [...generateAllocations(normalised, resolved.maximumAllocations)]
  )

  outer: for (const allocation of allocations) {
    allocationsTested++
    if (Date.now() > deadline) {
      stopCause = "timeout"
      break
    }
    if (resolved.signal?.aborted === true) {
      stopCause = "cancelled"
      break
    }

    const deviation = individualDeviationOf(normalised, allocation)

    const selection = spend("skeleton", () =>
      selectSkeletons(normalised, allocation, SKELETONS_PER_ALLOCATION)
    )
    skeletonsGenerated += selection.generated
    uniqueSkeletonSignatures += selection.uniqueSignatures
    if (skeletonScores.length === 0) {
      // The first allocation's ranking, kept for the technical panel: it is the
      // one a reader wants to see, and recording every allocation's would bury
      // it in noise.
      skeletonScores.push(
        ...selection.scores.map(
          (entry) =>
            `${entry.family} · ${entry.score.map((c) => `${c.label}=${c.value}`).join(" ")}`
        )
      )
    }

    for (const skeleton of selection.skeletons) {
      skeletonsTested++
      if (Date.now() > deadline) {
        stopCause = "timeout"
        break outer
      }

      const space = spend("candidates", () => generateReducedCandidates(normalised, skeleton))
      candidatesGenerated += space.total
      if (space.impossible.length > 0) {
        // Not an impossible PROBLEM — an impossible pairing of duties. Recorded
        // rather than skipped in silence, because a run where every skeleton
        // dies here looks identical from the outside to a run that searched and
        // found nothing, and the two call for opposite fixes.
        placementNotes.push(
          `alloc#${allocation.rank}/squelette#${skeleton.rank} : abandonné, aucune forme légale pour ${space.impossible.length} journée(s) travaillée(s)`
        )
        continue
      }

      const slice = Math.min(budget.nodes, NODES_PER_PLACEMENT)
      if (slice <= 0) {
        stopCause = "state-limit"
        break outer
      }
      const placementBudget = { nodes: slice }

      const outcome = spend("placement", () =>
        placeWeek(
          normalised,
          skeleton,
          space,
          resolved,
          { individualDeviationMinutes: deviation, fairnessSpread: fairnessSpreadOf(normalised, skeleton) },
          bestObjective,
          deadline,
          placementBudget
        )
      )
      budget.nodes -= slice - placementBudget.nodes
      placementNodes += outcome.nodes
      placementNotes.push(
        `alloc#${allocation.rank}/squelette#${skeleton.rank} : motifs [${outcome.patternCounts.join(",")}] · ${outcome.walkNote} · ${outcome.stopCause} · ${outcome.shifts === null ? "aucune solution" : "solution trouvée"}`
      )

      if (outcome.shifts !== null && outcome.objective !== null) {
        if (bestObjective === null || compareObjective(outcome.objective, bestObjective) < 0) {
          bestShifts = outcome.shifts
          bestObjective = outcome.objective
        }
      }

      if (outcome.stopCause === "cancelled") {
        stopCause = "cancelled"
        break outer
      }
      if (outcome.stopCause === "timeout") {
        stopCause = "timeout"
        break outer
      }
      // A per-placement slice running out cuts THIS skeleton, not the run — the
      // next one still deserves its turn. Only the global budget ends the run,
      // and it is checked at the top of the loop.
      if (outcome.stopCause === "state-limit" && budget.nodes <= 0) {
        stopCause = "state-limit"
        break outer
      }
    }
  }

  // ── Phase 6 ───────────────────────────────────────────────────────────────
  let repairsTested = 0
  let repairsApplied = 0
  if (resolved.repairEnabled && bestShifts !== null && bestObjective !== null) {
    const repaired = spend("repair", () =>
      repairLocally(normalised, bestShifts!, bestObjective!, resolved, deadline)
    )
    bestShifts = repaired.shifts
    bestObjective = repaired.objective
    repairsTested = repaired.tested
    repairsApplied = repaired.applied
  }

  const durationMs = Date.now() - startedAt
  const statistics: PlanningSolverStatisticsV3 = {
    candidatesGenerated,
    dailyPatternsEvaluated: skeletonsTested,
    weeklyStatesEvaluated: placementNodes,
    branchesPrunedByBound: 0,
    branchesPrunedByFeasibility: 0,
    durationMs,
    peakOpenNodes: 0,
  }

  const counters = {
    allocationsTested,
    skeletonsTested,
    candidatesGenerated,
    placementNodes,
    repairsTested,
    repairsApplied,
  }

  if (bestShifts === null || bestObjective === null) {
    // Exhausting the DECLARED space proves nothing about the problem: the space
    // was reduced on purpose. Only a search that was never cut short may speak,
    // and even then it speaks about what it enumerated.
    const exhausted = stopCause === "exhausted"
    const diagnostics: PlanningInfeasibilityV3[] = exhausted
      ? [
          {
            code: "no_placement_in_reduced_space",
            message:
              "Aucune combinaison légale n'a été trouvée dans l'espace réduit exploré. L'espace étant volontairement restreint, l'infaisabilité du problème n'est PAS démontrée.",
          },
        ]
      : []

    return {
      result: emptyResult(
        exhausted ? "infeasible" : "feasible-timeout",
        diagnostics,
        durationMs,
        stopCause,
        exhausted
          ? "Espace réduit entièrement exploré sans solution légale ; l'espace est un sous-ensemble déclaré, donc rien n'est prouvé sur le problème."
          : `Recherche interrompue (${stopCause}) avant toute solution légale.`,
        statistics
      ),
      report: baseReport(stopCause, counters),
    }
  }

  const solution = toSolution(normalised, bestShifts, problemFingerprint, bestObjective)

  return {
    result: {
      // Never `optimal`. The candidate space is reduced by construction, so the
      // only honest status for a schedule found inside it is "legal, found,
      // nothing proven".
      status: "feasible-timeout",
      solution,
      objective: bestObjective,
      proof: {
        kind: "none",
        objectiveValues: bestObjective,
        note: `Moteur décomposé : planning légal trouvé dans un espace de candidats volontairement réduit (arrêt : ${stopCause}). Aucune optimalité n'est démontrée et aucune ne peut l'être par ce moteur.`,
        candidateSpace: "incomplete",
        candidatesGenerated,
        dailyPatternsEvaluated: skeletonsTested,
        weeklyStatesEvaluated: placementNodes,
        branchesPrunedByBound: 0,
        durationMs,
        bestObjective,
        lowerBound: null,
        stopCause,
        deterministic: true,
        splitShiftsSupported: true,
      },
      statistics,
      diagnostics: assumptionDiagnostics(normalised.rules.assumed),
    },
    report: baseReport(stopCause, {
      ...counters,
      solutionFingerprint: fingerprintSolution(solution),
      bestObjective: describeObjective(bestObjective),
    }),
  }
}

/**
 * How far the allocation lands from a proportional share of each day.
 *
 * An employee owing a third of the week's minutes should carry about a third of
 * each day. Summed as an absolute deviation so a day over target and a day
 * under it do not cancel out — the point is the shape of the week, not its
 * total, which the contract has already fixed exactly.
 */
function individualDeviationOf(
  normalised: { employees: readonly { contractMinutes: number }[]; days: readonly { budgetMinutes: number }[] },
  allocation: Allocation
): number {
  const totalBudget = normalised.days.reduce((sum, day) => sum + day.budgetMinutes, 0)
  if (totalBudget === 0) return 0

  let deviation = 0
  for (let employeeIndex = 0; employeeIndex < normalised.employees.length; employeeIndex++) {
    const contract = normalised.employees[employeeIndex].contractMinutes
    for (let dayIndex = 0; dayIndex < normalised.days.length; dayIndex++) {
      const target = (contract * normalised.days[dayIndex].budgetMinutes) / totalBudget
      deviation += Math.abs(allocation.minutes[employeeIndex][dayIndex] - target)
    }
  }
  return Math.round(deviation)
}

/** Spread between the busiest and the quietest holder of each unpopular duty. */
function fairnessSpreadOf(
  normalised: { employees: readonly unknown[] },
  skeleton: Skeleton
): number {
  const openings = new Array<number>(normalised.employees.length).fill(0)
  const closings = new Array<number>(normalised.employees.length).fill(0)
  for (const entry of skeleton.entries) {
    if (entry.opens) openings[entry.employeeIndex]++
    if (entry.closes) closings[entry.employeeIndex]++
  }
  return spread(openings) + spread(closings)
}

function spread(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.max(...values) - Math.min(...values)
}

function toSolution(
  normalised: { employees: readonly { id: PlanningAssignmentV3["employeeId"] }[]; days: readonly { date: string }[] },
  shifts: readonly ReducedCandidate[],
  problemFingerprint: string,
  objective: DecomposedObjective
): PlanningSolutionV3 {
  const assignments: PlanningAssignmentV3[] = shifts
    .map((shift) => ({
      employeeId: normalised.employees[shift.employeeIndex].id,
      date: normalised.days[shift.dayIndex].date as PlanningAssignmentV3["date"],
      segments: shift.segments.map((segment) => ({ ...segment })),
    }))
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        String(left.employeeId).localeCompare(String(right.employeeId))
    )

  return {
    version: PLANNING_SOLUTION_V3_VERSION,
    problemFingerprint,
    assignments,
    // The engine commits to the one figure it computes the same way the
    // validator does. The validator recomputes it independently and reports a
    // blocking violation on disagreement — which is the cross-check, and the
    // reason declaring nothing at all would be the weaker choice.
    declaredMetrics: { totalDeficitMinutes: objective[2] ?? 0 },
  }
}

function assumptionDiagnostics(assumed: readonly string[]): PlanningInfeasibilityV3[] {
  if (assumed.length === 0) return []
  return [
    {
      code: "assumed_rules",
      message: `Règles non déclarées par le problème et supposées par le moteur : ${assumed.join(", ")}. Le planning reste légal au regard des règles déclarées, mais ces valeurs ne viennent pas de la configuration.`,
    },
  ]
}

function emptyResult(
  status: PlanningSolverResultV3["status"],
  diagnostics: readonly PlanningInfeasibilityV3[],
  durationMs: number,
  stopCause: DecomposedStopCause,
  note: string,
  statistics?: PlanningSolverStatisticsV3
): PlanningSolverResultV3 {
  return {
    status,
    solution: null,
    objective: null,
    proof: {
      kind: "none",
      objectiveValues: [],
      note,
      candidateSpace: "incomplete",
      stopCause,
      deterministic: true,
      splitShiftsSupported: true,
    },
    statistics: statistics ?? {
      candidatesGenerated: 0,
      dailyPatternsEvaluated: 0,
      weeklyStatesEvaluated: 0,
      branchesPrunedByBound: 0,
      branchesPrunedByFeasibility: 0,
      durationMs,
      peakOpenNodes: 0,
    },
    diagnostics,
  }
}

function resolveOptions(options: DecomposedOptions): DecomposedResolvedOptions {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maximumAllocations: options.maximumAllocations ?? DEFAULT_MAXIMUM_ALLOCATIONS,
    maximumPlacementNodes: options.maximumPlacementNodes ?? DEFAULT_MAXIMUM_PLACEMENT_NODES,
    repairEnabled: options.repairEnabled ?? true,
    signal: options.signal ?? null,
    assumedMinimumSplitMinutes:
      options.assumedMinimumSplitMinutes ?? DEFAULT_ASSUMED_MINIMUM_SPLIT_MINUTES,
  }
}
