/**
 * Universal, sector-agnostic constraint categories. Intentionally an OPEN set
 * (`Known | (string & {})`) so a business pack can introduce its own category
 * without modifying the engine.
 *
 * Categories describe WHAT kind of rule a constraint expresses, independent of
 * any industry:
 * - `legal`        — statutory / regulatory limits.
 * - `availability` — when a resource can or cannot be scheduled.
 * - `workload`     — quantity of work (hours, counts, durations).
 * - `coverage`     — demand that must be met (required staffing).
 * - `fairness`     — equitable distribution across resources.
 * - `preference`   — soft wishes expressed by a resource.
 * - `continuity`   — stability across time (rest, consecutive periods).
 */
export const CONSTRAINT_CATEGORIES = [
  "legal",
  "availability",
  "workload",
  "coverage",
  "fairness",
  "preference",
  "continuity",
] as const
export type KnownConstraintCategory = (typeof CONSTRAINT_CATEGORIES)[number]
export type ConstraintCategory = KnownConstraintCategory | (string & {})
