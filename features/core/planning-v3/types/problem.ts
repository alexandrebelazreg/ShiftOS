import type { EmployeeId, IsoDate, PlanningId, WeekDay } from "@/features/core/models"

/**
 * Planning V3 problem model — the immutable, versioned description of ONE
 * scheduling problem.
 *
 * Two invariants hold everywhere in this module:
 * - every duration is an integer number of minutes;
 * - every time of day is an integer number of minutes since midnight, so
 *   06:00 is 360 and 20:00 is 1200. No "HH:mm" string survives the builder.
 *
 * The model is deliberately self-contained: a `PlanningProblemV3` carries
 * everything a solver or a validator needs, so neither has to reach back into
 * the application, the repositories or the V2 pipeline.
 */

/** Schema version. Bumped whenever the problem shape changes incompatibly. */
export const PLANNING_PROBLEM_V3_VERSION = "v3.0.0"
export type PlanningProblemVersionV3 = typeof PLANNING_PROBLEM_V3_VERSION

/**
 * Objective codes, ordered lexicographically by `PlanningProblemV3.objectives`:
 * the first objective is optimised first and later ones may never degrade it.
 */
export const PLANNING_OBJECTIVES_V3 = [
  "coverage-deficit",
  "contract-deviation",
  "avoidable-surplus",
  "opening-fairness",
  "closing-fairness",
  "preference-satisfaction",
] as const
export type PlanningObjectiveV3 = (typeof PLANNING_OBJECTIVES_V3)[number]

/** One employee, with the exact contract and capability facts V3 reasons about. */
export interface PlanningEmployeeV3 {
  readonly id: EmployeeId
  readonly firstName: string
  readonly lastName: string
  /** Exact contracted duration for one week. Always integer minutes. */
  readonly contractMinutes: number
  /** Week days the contract covers. */
  readonly workingDays: readonly WeekDay[]
  /** Week days the employee never works (FIXED_DAY_OFF / FORBIDDEN_DAY). */
  readonly fixedRestDays: readonly WeekDay[]
  readonly minimumDailyMinutes: number
  readonly maximumDailyMinutes: number
  readonly canOpen: boolean
  readonly canClose: boolean
  readonly canSplitShift: boolean
  /** Null means "no explicit limit", never "zero". */
  readonly maximumOpenings: number | null
  readonly maximumClosings: number | null
  readonly prefersOpening: boolean
  readonly prefersClosing: boolean
}

/** One calendar day of the horizon, with its opening window and exact budget. */
export interface PlanningDayV3 {
  readonly date: IsoDate
  readonly weekDay: WeekDay
  /** ISO-8601 week bucket, used to scope the weekly contract check. */
  readonly weekKey: string
  readonly closed: boolean
  /** Minute of day the sector opens; null when closed. */
  readonly opensAtMinutes: number | null
  /** Minute of day the sector closes; null when closed. */
  readonly closesAtMinutes: number | null
  /**
   * Exact number of worked minutes this day must receive, all employees
   * combined. Derived from the weekly distribution, never approximated.
   */
  readonly budgetMinutes: number
}

/**
 * What one employee may do on one date. Availability is dated (absences and
 * holidays are), so it cannot live on `PlanningEmployeeV3`.
 */
export interface PlanningEmployeeDayV3 {
  readonly employeeId: EmployeeId
  readonly date: IsoDate
  /** False when the employee cannot work at all that day. */
  readonly available: boolean
  /** True when the employee MUST work that day (`workEveryNonFixedRestDay`). */
  readonly mandatory: boolean
  /** True when the day is one of the employee's fixed rest days. */
  readonly fixedRest: boolean
  readonly earliestStartMinutes: number
  readonly latestEndMinutes: number
  /** Upper bound on worked minutes that day, after every cap is applied. */
  readonly maximumMinutes: number
  readonly unavailableReason?: string
}

/** One elementary demand slot: "over [start, end) this date, need N people". */
export interface PlanningDemandSlotV3 {
  readonly id: string
  readonly date: IsoDate
  readonly startMinutes: number
  readonly endMinutes: number
  /**
   * The business TARGET head-count. Soft: contracted minutes are finite, so a
   * demand that exceeds what the contracts can cover leaves every possible
   * schedule short somewhere. Falling below it is a degradation requiring an
   * explicit acceptance, never a refusal to publish.
   */
  readonly requiredEmployees: number
  /**
   * The OPERATIONAL FLOOR: how many people must be present at every instant of
   * the window, no matter what. Absent on every slot the application builds
   * today, and absent means "no floor declared" — never zero, and never a
   * silent copy of `requiredEmployees`.
   *
   * Distinct from `requiredEmployees` because the two answer different
   * questions. "Someone must be on the floor from open to close" is a fact
   * about the business being able to operate at all; "three people at the
   * lunch peak" is a target that bends to the team actually available. A
   * schedule may miss the second. A schedule that misses the first is not a
   * worse schedule, it is an illegal one — so the validator reports it as
   * `blocking` and it is NOT counted in the coverage deficit.
   */
  readonly hardMinimumEmployees?: number
  /** Null when the slot has no explicit head-count ceiling. */
  readonly maximumEmployees: number | null
}

/** A legal shift shape a solver may propose. V3A only describes it. */
export interface PlanningShiftCandidateV3 {
  readonly employeeId: EmployeeId
  readonly date: IsoDate
  readonly startMinutes: number
  readonly endMinutes: number
  readonly opensDay: boolean
  readonly closesDay: boolean
}

/** Rules that apply to every employee of the problem. */
export interface PlanningRulesV3 {
  readonly minimumShiftMinutes: number
  readonly maximumShiftMinutes: number
  /** Minimum rest between the end of one day and the start of the next. */
  readonly minimumRestMinutes: number
  /** Null means the rule is not enforced. */
  readonly maximumConsecutiveWorkedDays: number | null
  /**
   * Where `maximumConsecutiveWorkedDays` comes from.
   *
   * - `configured`: read from the application configuration; a real rule.
   * - `derived-fallback`: no configuration field exists, so the builder emitted
   *   a structural, non-binding value. It must NOT be read as a business,
   *   legal or regulatory limit.
   */
  readonly maximumConsecutiveWorkedDaysSource: "configured" | "derived-fallback"
  readonly splitShiftAllowed: boolean
  /** Longest gap allowed inside a split shift; null when splits are forbidden. */
  readonly maximumSplitMinutes: number | null
  /**
   * Shortest gap that COUNTS as a split rather than a pause, in minutes.
   *
   * Optional because no application field produced it before this sprint.
   * Absent means "not declared", so an engine that needs a floor must say it
   * is assuming one rather than pretend the problem stated it.
   */
  readonly minimumSplitMinutes?: number | null
  /**
   * Longest UNINTERRUPTED stretch one employee may work, in minutes.
   *
   * Distinct from `maximumShiftMinutes`, which caps the whole day: a 10-hour
   * day is legal when it is split, and illegal when it is one block. Absent
   * means the rule is not enforced.
   */
  readonly maximumContinuousMinutes?: number | null
  /** How many splits one employee may have in one day. Absent means unlimited. */
  readonly maximumSplitsPerDay?: number | null
  /**
   * How many employees must start exactly at opening, AT LEAST, on every open
   * day. A minimum rather than an exact count: a peak that demands four people
   * at 06:00 needs four of them to start at 06:00.
   */
  readonly minimumOpeningsPerDay: number
  /**
   * How many employees must finish exactly at closing, EXACTLY, on every open
   * day. Unlike opening, closing is a single responsibility — one person locks
   * up — so a second closer is a defect, not extra coverage.
   */
  readonly exactClosingsPerDay: number
}

/** The complete, immutable problem. */
export interface PlanningProblemV3 {
  readonly version: PlanningProblemVersionV3
  readonly planningId: PlanningId
  readonly sectorId: string
  readonly period: { readonly start: IsoDate; readonly end: IsoDate }
  /** Time step every start, end and duration must be a multiple of. */
  readonly timeStepMinutes: number
  readonly employees: readonly PlanningEmployeeV3[]
  readonly days: readonly PlanningDayV3[]
  readonly employeeDays: readonly PlanningEmployeeDayV3[]
  readonly demandSlots: readonly PlanningDemandSlotV3[]
  readonly rules: PlanningRulesV3
  /** Objectives in strict lexicographic priority order. */
  readonly objectives: readonly PlanningObjectiveV3[]
}
