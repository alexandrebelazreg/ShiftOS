import type { StoreId } from "@/features/core/models"

/**
 * StoreStatistics — factual roll-up at the store level for the planning.
 *
 * - `generatedShifts` — number of shifts in the planning.
 * - `assignmentCount` — in-period assignments (the "Assignments" figure).
 * - `coverageRate`    — from the demand engine's coverage (`[0, 1]`); `null`
 *   when no coverage was supplied.
 * - `coverageGaps`    — number of coverage gaps reported by the demand engine
 *   (0 when no coverage was supplied). Never recomputed here.
 */
export interface StoreStatistics {
  readonly storeId: StoreId
  readonly generatedShifts: number
  readonly assignmentCount: number
  readonly coverageRate: number | null
  readonly coverageGaps: number
}
