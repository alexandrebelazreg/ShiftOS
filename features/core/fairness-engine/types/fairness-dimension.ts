/**
 * The fairness dimensions the engine can measure — WHAT is being distributed
 * across the team. Intentionally an OPEN set (`Known | (string & {})`) so a new
 * dimension can be introduced by a pluggable calculator without editing the
 * engine.
 *
 * Shipped dimensions are backed by `EmployeeStatistics`:
 * - `worked_hours` — total worked minutes.
 * - `opening`      — opening shifts taken.
 * - `closing`      — closing shifts taken.
 * - `split_shift`  — split shifts taken.
 * - `weekend`      — weekend days worked.
 *
 * `saturday`, `sunday` and `night` are recognized identifiers but ship no
 * calculator yet: their per-employee counts do not exist in `EmployeeStatistics`
 * today. Each becomes a one-calculator + one-registration addition once its
 * count is available upstream.
 */
export const FAIRNESS_DIMENSIONS = [
  "worked_hours",
  "opening",
  "closing",
  "split_shift",
  "weekend",
  "saturday",
  "sunday",
  "night",
] as const
export type KnownFairnessDimension = (typeof FAIRNESS_DIMENSIONS)[number]
export type FairnessDimension = KnownFairnessDimension | (string & {})

/**
 * Which side of the mean an imbalance falls on.
 * - `over`  — this employee carries MORE than the mean (potentially overloaded).
 * - `under` — this employee carries LESS than the mean.
 *
 * The engine only reports the fact; it never decides whether "more" is good or
 * bad — that is business policy.
 */
export const IMBALANCE_DIRECTIONS = ["over", "under"] as const
export type ImbalanceDirection = (typeof IMBALANCE_DIRECTIONS)[number]
