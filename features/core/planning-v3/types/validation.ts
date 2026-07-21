import type { EmployeeId, IsoDate } from "@/features/core/models"

/**
 * Planning V3 validation model — the structured verdict produced by the
 * independent validator.
 */

export const PLANNING_VALIDATION_V3_VERSION = "v3.0.0"
export type PlanningValidationVersionV3 = typeof PLANNING_VALIDATION_V3_VERSION

/**
 * Every rule the validator can report on. One code per rule so a test can
 * assert that a given corruption fails exactly one of them.
 */
export const PLANNING_RULES_V3 = [
  "contract-minutes",
  "daily-minutes",
  "daily-budget",
  "mandatory-day",
  "fixed-rest-day",
  "availability",
  "minimum-shift",
  "maximum-shift",
  "split-shift",
  "minimum-rest",
  "consecutive-days",
  "opening-capability",
  "closing-capability",
  "maximum-openings",
  "maximum-closings",
  "opening-count",
  "closing-count",
  "coverage-deficit",
  "declared-metrics",
  "time-step",
  "solution-integrity",
] as const
export type PlanningRuleCodeV3 = (typeof PLANNING_RULES_V3)[number]

/**
 * - `blocking`: a hard constraint is broken. Such a solution may never be
 *   published once V3 goes live.
 * - `degradation`: legal, but measurably worse than it should be.
 * - `information`: neutral fact worth surfacing.
 */
export type PlanningViolationSeverityV3 = "blocking" | "degradation" | "information"

export interface PlanningViolationV3 {
  readonly rule: PlanningRuleCodeV3
  readonly severity: PlanningViolationSeverityV3
  readonly message: string
  readonly employeeId?: EmployeeId
  readonly date?: IsoDate
  /** The value the rule requires, when the rule is numeric. */
  readonly expected?: number
  /** The value recomputed from the solution. */
  readonly actual?: number
}

/**
 * A reason the PROBLEM itself admits no legal solution — reported by the
 * builder, before any solving happens.
 */
export interface PlanningInfeasibilityV3 {
  readonly code: string
  readonly message: string
  readonly employeeId?: EmployeeId
  readonly date?: IsoDate
  readonly path?: string
}

/**
 * What is actually proven about a solution.
 *
 * `kind` is `"none"` for every solution V3A can produce: no global solver has
 * run, so nothing is proven. `"optimal"` may only ever be set by a completed
 * global solver that returns a genuine optimality certificate — the UI must
 * not announce an optimum on any other basis.
 */
export interface PlanningSolverProofV3 {
  readonly kind: "none" | "feasible" | "optimal"
  /** Objective values in the problem's lexicographic order. */
  readonly objectiveValues: readonly number[]
  readonly note: string
}

/** Figures the validator recomputes from scratch, for display and comparison. */
export interface PlanningMetricsV3 {
  /** Worked minutes per employee and ISO week: `"employeeId|weekKey"`. */
  readonly weeklyMinutesByEmployeeWeek: Readonly<Record<string, number>>
  /** Worked minutes per employee and date: `"employeeId|date"`. */
  readonly dailyMinutesByEmployeeDate: Readonly<Record<string, number>>
  /** Worked minutes per date, all employees combined. */
  readonly dailyMinutesByDate: Readonly<Record<string, number>>
  readonly openingsByEmployee: Readonly<Record<string, number>>
  readonly closingsByEmployee: Readonly<Record<string, number>>
  /** Missing employee-minutes across every demand slot. */
  readonly totalDeficitMinutes: number
  /** Employee-minutes worked beyond what the demand slots require. */
  readonly totalSurplusMinutes: number
  /**
   * The part of the surplus no schedule can avoid, because the contracted
   * minutes exceed the minimum demanded minutes. Depends on the problem only.
   */
  readonly structuralSurplusMinutes: number
  /** `totalSurplus - structuralSurplus`: the part a better schedule could remove. */
  readonly avoidableSurplusMinutes: number
}

export interface PlanningValidationReportV3 {
  readonly version: PlanningValidationVersionV3
  /** True when no blocking violation was found. */
  readonly validHardConstraints: boolean
  readonly violations: readonly PlanningViolationV3[]
  readonly degradations: readonly PlanningViolationV3[]
  readonly informations: readonly PlanningViolationV3[]
  readonly metrics: PlanningMetricsV3
  readonly proof: PlanningSolverProofV3
  /** Deterministic fingerprint of the validated solution. */
  readonly fingerprint: string
}
