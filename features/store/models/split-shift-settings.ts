import type { Minutes } from "@/features/core/models"

/**
 * SplitShiftSettings — whether and how split shifts are allowed. When
 * `enabled` is false the break bounds are ignored.
 */
export interface SplitShiftSettings {
  readonly enabled: boolean
  /** Minimum break between two segments of a split shift. */
  readonly minBreak: Minutes
  /** Maximum break between two segments of a split shift. */
  readonly maxBreak: Minutes
  /** Maximum number of split shifts a single employee may work per week. */
  readonly maxSplitShiftsPerEmployee: number
}
