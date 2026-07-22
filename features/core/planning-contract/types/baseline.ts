import type { EmployeeId, IsoDate } from "@/features/core/models"
import type { PlanningSegmentV3 } from "@/features/core/planning-v3/types/solution"

/**
 * The schedule a regeneration is measured AGAINST.
 *
 * Locks and manual edits are keyed by `shiftId`, and a `PlanningProblemV3`
 * contains no shifts — it describes what is legal, not what was decided. So
 * nothing in a request made only of a problem and a regeneration can answer
 * "which employee, which day, which minutes does `s_42` mean?", and an engine
 * asked to keep `s_42` exactly where it is has no way to know where that is.
 *
 * The baseline closes that hole. It is the currently displayed schedule, in the
 * engine-neutral vocabulary, and it does three jobs at once:
 * - it resolves a locked id into the assignment that must be reproduced;
 * - it resolves an edited id into the employee and day the new minutes apply to;
 * - it is the reference `minimizeOtherChanges` measures drift from.
 *
 * Optional, because a first generation has nothing to preserve and nothing to
 * stay close to. An engine handed locks WITHOUT a baseline cannot honour them
 * and must report them unmet rather than guess.
 */

export interface PlanningBaselineShiftV3 {
  /** The board's id for this shift. The only thing locks and edits can name. */
  readonly shiftId: string
  readonly employeeId: EmployeeId
  readonly date: IsoDate
  readonly segments: readonly PlanningSegmentV3[]
}

export interface PlanningBaselineV3 {
  readonly shifts: readonly PlanningBaselineShiftV3[]
}
