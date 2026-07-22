import { UnsupportedRequestContractError } from "@/features/core/planning-contract/errors"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type {
  PlanningSolveAdapter,
  SolvePlanningResponse,
} from "@/features/core/planning-contract/types/solve-response"

/**
 * V2 / Sprint 3D.1 behind the neutral contract — and refusing the contract.
 *
 * Named `legacy` rather than `current` because "current" described a moment,
 * not a capability, and it read as a promise this adapter cannot keep. V2 is
 * driven by a V2 `GenerationInput` assembled from repositories. A
 * `SolvePlanningRequest` is not that, and is not convertible into it: the V3
 * problem is a projection taken AFTER the V2 pipeline has already distributed
 * budgets, dated availability and dropped "HH:mm", so reconstructing the input
 * would mean inventing the very decisions V2 is supposed to make. On top of
 * that the request carries locks, manual edits and a stability objective, none
 * of which exist anywhere in the V2 vocabulary.
 *
 * So it refuses, with a structured `unsupported-request-contract`, and it
 * refuses ALWAYS — not only when a regeneration is attached. A version that
 * accepted the easy half of the contract would answer a different question than
 * the one asked and no one would find out until a manager compared two weeks.
 *
 * There is NO fallback. V2 remains reachable through its own call path until an
 * engine that genuinely speaks `SolvePlanningRequest` replaces it; this adapter
 * exists so the contract enumerates every engine honestly, not so V2 can be
 * smuggled through it.
 */
export const solveWithLegacyV2Adapter: PlanningSolveAdapter = async (
  request: SolvePlanningRequest
): Promise<SolvePlanningResponse> => {
  void request
  throw new UnsupportedRequestContractError(
    "v2",
    "le pipeline V2 consomme un GenerationInput V2 et ne sait lire ni un PlanningProblemV3, ni des verrous, ni des retouches manuelles ; aucune traduction fidèle n'existe."
  )
}
