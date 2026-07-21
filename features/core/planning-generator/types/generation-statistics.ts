/**
 * GenerationStatistics — a factual account of what the generation run did. Pure
 * counters (no timing, so the report stays deterministic); they explain the run
 * without re-deriving anything from the planning.
 */
export interface GenerationStatistics {
  /** Name of the strategy that produced the planning. */
  readonly strategy: string

  readonly requirementsTotal: number
  readonly requirementsFullyCovered: number
  readonly requirementsPartiallyCovered: number
  readonly requirementsUncovered: number

  readonly shiftsCreated: number
  readonly assignmentsCreated: number

  readonly employeesConsidered: number
  readonly employeesAssigned: number

  /** Candidate placements refused because they would add a hard violation. */
  readonly candidatesRejectedByHardConstraints: number
  /** Number of constraint-engine evaluations performed during generation. */
  readonly constraintEvaluations: number
}
