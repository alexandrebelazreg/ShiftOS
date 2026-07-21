import type { Minutes } from "@/features/core/models"

/**
 * ShiftSettings — per-shift and per-day working bounds the constraint engine
 * enforces. Values only; the rules that USE them live in the engines.
 */
export interface ShiftSettings {
  /** Minimum rest between two shifts. */
  readonly minRestBetweenShifts: Minutes
  /** Minimum worked minutes in a single day. */
  readonly minDailyDuration: Minutes
  /** Maximum worked minutes in a single day. */
  readonly maxDailyDuration: Minutes
  /** Maximum worked minutes in a single week. */
  readonly maxWeeklyDuration: Minutes
  /** Tolerance when comparing worked vs contracted hours (feeds the soft contract constraint). */
  readonly contractToleranceMinutes: Minutes
}
