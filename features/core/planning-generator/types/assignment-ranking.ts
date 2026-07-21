import type { AssignmentId, EmployeeId, ShiftId } from "@/features/core/models"
import type { CoverageRequirementId } from "@/features/core/demand-engine"

/** One dimension's contribution to a candidate's score — the explainability unit. */
export interface RankingContribution {
  readonly dimension: string
  readonly weight: number
  readonly rawScore: number
  readonly weightedScore: number
}

/** A scored candidate: the blended score plus the per-dimension breakdown. */
export interface RankedCandidate {
  readonly employeeId: EmployeeId
  readonly score: number
  readonly contributions: readonly RankingContribution[]
}

/**
 * AssignmentRanking — why one employee was chosen for one slot: the selected
 * candidate's full breakdown, plus the other compatible candidates that ranked
 * below. Structured explainability data, produced by the strategy and surfaced
 * on the generation result; no UI.
 */
export interface AssignmentRanking {
  readonly assignmentId: AssignmentId
  readonly requirementId: CoverageRequirementId
  readonly shiftId: ShiftId
  readonly selected: RankedCandidate
  readonly alternatives: readonly RankedCandidate[]
}
