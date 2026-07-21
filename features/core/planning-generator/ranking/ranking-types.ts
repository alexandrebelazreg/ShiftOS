import type { Contract, EmployeeId } from "@/features/core/models"

/**
 * RankingContext — the precomputed snapshot a dimension scores against. Building
 * it once per slot (and the expensive fairness load once per requirement) keeps
 * the dimensions themselves trivial: each is a pure read + arithmetic.
 */
export interface RankingContext {
  /** Minutes already assigned to each employee in THIS generation so far. */
  readonly assignedMinutesByEmployee: ReadonlyMap<EmployeeId, number>
  /** The largest `assignedMinutes` across the cohort (for workload normalization). */
  readonly maxAssignedMinutes: number
  /** Each employee's contract (for contract-balance). */
  readonly contractByEmployee: ReadonlyMap<EmployeeId, Contract>
  /** Fairness "debt" per employee in `[0, 1]`, derived from the Fairness Engine. */
  readonly fairnessLoadByEmployee: ReadonlyMap<EmployeeId, number>
  /** Duration of the shift being filled (minutes). */
  readonly shiftMinutes: number
}

/**
 * RankingDimension — one pluggable axis of candidate quality. Adding a dimension
 * is implementing this interface and registering it in the dimension list; the
 * ranker and the strategy never change. Each `score` returns `[0, 1]` where
 * higher = better candidate.
 *
 * This is what avoids giant if/else chains: the ranker iterates dimensions, it
 * never branches on their identity.
 */
export interface RankingDimension {
  readonly name: string
  /** Relative weight in the blended score (normalized by the ranker). */
  readonly weight: number
  score(employeeId: EmployeeId, context: RankingContext): number
}
