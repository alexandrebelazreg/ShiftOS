import { solveAndValidateDecomposedV3 } from "@/features/core/planning-v3/orchestrator/solve-and-validate-decomposed"
import type { AuditedDecomposedSolution } from "@/features/core/planning-v3/orchestrator/solve-and-validate-decomposed"
import type { DecomposedOptions } from "@/features/core/planning-v3/solver-decomposed"

import { toBackendErrorResponse } from "@/features/core/planning-contract/errors"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type {
  PlanningSolveAdapter,
  SolvePlanningResponse,
  SolveTechnicalFact,
} from "@/features/core/planning-contract/types/solve-response"
import type { EnginePreservationSupport } from "@/features/core/planning-contract/adapters/from-audited-v3"
import { toSolvePlanningResponse } from "@/features/core/planning-contract/adapters/from-audited-v3"

/**
 * The decomposed TypeScript engine, behind the neutral contract.
 *
 * It runs in-process — no subprocess, no Python, no native dependency — so
 * unlike CP-SAT it is importable from anywhere, and unlike CP-SAT it has no
 * transport that can fail. What it does share is the contract: a caller holding
 * this as a `PlanningSolveAdapter` cannot tell which engine it is holding,
 * which is the whole property the contract exists to buy.
 *
 * Like the DFS prototype, it solves from scratch every time: it cannot pin a
 * shift, cannot keep a manual move, and does not optimise for stability against
 * a previous schedule. `DECOMPOSED_PRESERVATION_SUPPORT` states that plainly,
 * and the mapper turns it into unmet preservations, diagnostics a manager can
 * act on, and — through the contract invariants — a standing refusal to call
 * such a run `optimal`.
 *
 * That refusal is doubly true here. The engine searches a DELIBERATELY REDUCED
 * space: only the first few minute allocations, only the best patterns of each
 * day. `proof.kind` is `"none"` at the source and this adapter never upgrades
 * it. A good answer to a smaller question is not an optimum.
 */
export const DECOMPOSED_PRESERVATION_SUPPORT: EnginePreservationSupport = {
  locks: false,
  manualEdits: false,
  minimizeOtherChanges: false,
}

export function createDecomposedV3Adapter(
  options: DecomposedOptions = {}
): PlanningSolveAdapter {
  return async (request: SolvePlanningRequest): Promise<SolvePlanningResponse> => {
    let run: AuditedDecomposedSolution
    try {
      run = solveAndValidateDecomposedV3(request.problem, options)
    } catch (error) {
      // An engine that throws has told us nothing about the problem. Reporting
      // that as `infeasible` would turn a crash into a business verdict.
      return toBackendErrorResponse("decomposed-v3", error, request)
    }

    // Deliberately NOT wrapped: a contract violation raised below is a defect in
    // the translation, and swallowing it into a `backend-error` would hide the
    // one bug this boundary exists to catch.
    const response = toSolvePlanningResponse(
      "decomposed-v3",
      request,
      run.audited,
      DECOMPOSED_PRESERVATION_SUPPORT
    )

    return {
      ...response,
      diagnostics: {
        ...response.diagnostics,
        technical: [...response.diagnostics.technical, ...technicalFacts(run)],
      },
    }
  }
}

/**
 * The engine internals a support log needs, already worded.
 *
 * Kept in `technical` rather than in `entries`: none of it asks a manager for a
 * decision, and a diagnostic that requires no decision must never appear where
 * the ones that do are read.
 */
function technicalFacts(run: AuditedDecomposedSolution): SolveTechnicalFact[] {
  const report = run.report
  const facts: SolveTechnicalFact[] = [
    { label: "Moteur", value: "décomposé (TypeScript, en processus)" },
    { label: "Temps total", value: `${report.totalMs} ms` },
    {
      label: "Temps par phase",
      value: report.phaseMs.map((phase) => `${phase.phase} ${phase.durationMs} ms`).join(" · "),
    },
    { label: "Allocations testées", value: String(report.allocationsTested) },
    { label: "Squelettes testés", value: String(report.skeletonsTested) },
    { label: "Candidats générés", value: String(report.candidatesGenerated) },
    { label: "Nœuds de placement", value: String(report.placementNodes) },
    {
      label: "Réparations locales",
      value: `${report.repairsApplied} appliquées sur ${report.repairsTested} testées`,
    },
    { label: "Empreinte du problème", value: report.problemFingerprint },
    { label: "Empreinte de la solution", value: report.solutionFingerprint ?? "aucune solution" },
    { label: "Cause d'arrêt", value: report.stopCause },
    {
      label: "Meilleur objectif",
      value:
        report.bestObjective === null
          ? "aucun"
          : report.bestObjective.map((entry) => `${entry.label}=${entry.value}`).join(" · "),
    },
  ]

  if (report.assumedRules.length > 0) {
    facts.push({
      label: "Règles supposées",
      value: `${report.assumedRules.join(", ")} — absentes du problème, valeurs par défaut du moteur`,
    })
  }

  return facts
}

/**
 * The adapter with no declared limit beyond the engine's own defaults.
 *
 * Prefer `createDecomposedV3Adapter({ timeoutMs })` anywhere a user is waiting.
 */
export const solveWithDecomposedV3: PlanningSolveAdapter = createDecomposedV3Adapter()
