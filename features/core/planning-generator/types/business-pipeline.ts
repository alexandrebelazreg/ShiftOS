import type { EmployeeId, WeekDay } from "@/features/core/models"

/**
 * One operational floor: how many people must be present, and when.
 *
 * The head-count profile a sector configures is a TARGET — it describes a
 * normal day and bends when the team shrinks. This is the other thing, the part
 * that does not bend: "someone must be on the floor from open to close" is what
 * lets the shop operate at all, and it is the reason a schedule can be refused
 * rather than merely reported as short-staffed.
 *
 * Windows are `"HH:mm"` local times. Omitting `day` applies the floor to every
 * open day; omitting `from` or `to` extends it to the sector's own opening or
 * closing, so "one person throughout" is a single entry with a head-count.
 */
export interface SectorPresenceFloor {
  /** Absent means every open day. */
  readonly day?: WeekDay
  /** Absent means the sector's opening time. */
  readonly from?: string
  /** Absent means the sector's closing time. */
  readonly to?: string
  readonly employees: number
}

export interface SectorPlanningRules {
  readonly id: string
  readonly name: string
  readonly active: boolean
  readonly weeklyDistribution: Readonly<Record<WeekDay, number>>
  /**
   * Per-day targets used when percentages are disabled.
   *
   * Percentages cannot express six identical days exactly (16.67 % each), so
   * the application may supply the quarter-hour totals derived from coverage.
   * Legacy and manually configured sectors omit this field and keep the
   * percentage computation unchanged.
   */
  readonly dailyBudgetMinutes?: Readonly<Record<WeekDay, number>>
  /**
   * `target` makes the percentage distribution an optimisation preference.
   * Absent preserves the historical exact-budget contract for old callers.
   */
  readonly dailyBudgetMode?: "exact" | "target"
  readonly minimumShiftDuration: number
  readonly splitShiftAllowed: boolean
  readonly maximumSplitDuration: number | null
  /**
   * Default weekly caps every employee of the sector inherits, unless they
   * declare their own. Absent (or null) means the sector sets no default, which
   * is NOT zero: an employee with neither an individual cap nor a sector one is
   * simply uncapped.
   */
  readonly maximumOpeningsPerWeek?: number | null
  readonly maximumClosingsPerWeek?: number | null
  /**
   * Advanced scheduling rules. All optional: a caller that predates the
   * « Contraintes avancées » block omits them, and the builder then keeps the
   * behaviour that caller was written against rather than inventing a rule.
   */
  readonly maximumDailyDuration?: number | null
  readonly maximumContinuousDuration?: number | null
  readonly minimumSplitDuration?: number | null
  readonly maximumSplitsPerDay?: number | null
  readonly minimumOpeningsPerDay?: number | null
  readonly requiredClosingsPerDay?: number | null
  readonly minimumRestMinutes?: number | null
  /** Soft closing-fairness policy. Absent means the sector declares none. */
  readonly closingFairness?: {
    readonly balanceClosings: boolean
    readonly balanceSaturdayClosings: boolean
    readonly lookbackWeeks: number
  } | null
  readonly assignedEmployeeIds: readonly EmployeeId[]
  readonly requirementIds: readonly string[]
  readonly workEveryNonFixedRestDay?: boolean
  readonly hours?: readonly { readonly day: WeekDay; readonly closed: boolean; readonly opensAt: string; readonly closesAt: string }[]
  /**
   * Unbreakable presence floors. Absent means the sector declares none, which
   * is NOT the same as declaring zero — a sector without floors simply has no
   * coverage its schedules may be refused over.
   */
  readonly minimumPresence?: readonly SectorPresenceFloor[]
}

export interface EmployeePlanningPreference {
  readonly employeeId: EmployeeId
  readonly prefersClosing: boolean
  /** Identifiants des rayons, dans l'ordre de priorité de la fiche salarié. */
  readonly sectorIds?: readonly string[]
}

export interface BusinessPlanningContext {
  readonly sectors?: readonly SectorPlanningRules[]
  readonly employeePreferences?: readonly EmployeePlanningPreference[]
  readonly pipelineMode?: "sprint-3d" | "legacy-v2"
}

export interface RepairAttemptStatistics {
  readonly family: string
  readonly generated: number
  readonly rejected: number
  readonly evaluated: number
  readonly accepted: number
}

export type PipelinePhaseName = "validation" | "demand-calculation" | "weekly-allocation" | "daily-placement" | "closing-assignment" | "legal-rest" | "opening-assignment" | "coverage" | "contract-completion" | "global-weekly-repair" | "optimisation" | "final-validation"
export interface PlanningExplanation { readonly phase: PipelinePhaseName; readonly assignmentId?: string; readonly employeeId?: EmployeeId; readonly requirementId?: string; readonly message: string; readonly reasons: readonly string[] }
export type PlanningIssueSeverity = "blocking" | "degradation" | "information"
export interface PlanningIssue { readonly code: string; readonly severity: PlanningIssueSeverity; readonly phase: PipelinePhaseName; readonly message: string; readonly requirementId?: string; readonly employeeId?: EmployeeId; readonly details?: Readonly<Record<string, string | number>> }
