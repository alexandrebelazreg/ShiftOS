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
  // Saturday BEFORE the general balance, and both after everything above.
  // Closing on a Saturday evening costs more than closing on a Tuesday, so a
  // week that shares Saturdays evenly but Tuesdays unevenly is fairer than the
  // reverse — and a lexicographic order is the only way to say that without
  // inventing an exchange rate between the two.
  "saturday-closing-fairness",
  "opening-fairness",
  "closing-fairness",
  "preference-satisfaction",
] as const
export const PLANNING_MULTI_SECTOR_OBJECTIVES_V3 = [
  ...PLANNING_OBJECTIVES_V3.slice(0, -1),
  "sector-switches",
  "sector-preference",
  "preference-satisfaction",
] as const
export type PlanningObjectiveV3 =
  | (typeof PLANNING_OBJECTIVES_V3)[number]
  | "sector-switches"
  | "sector-preference"

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
  /** Rayons autorisés, du plus prioritaire au moins prioritaire. */
  readonly allowedSectorIds?: readonly string[]
}

/**
 * Quel réglage a fixé `maximumMinutes` pour cette journée.
 *
 * Ce plafond est le minimum de cinq entrées qui ne se corrigent pas au même
 * endroit. Le porter sans sa provenance oblige à chercher dans cinq écrans, et
 * un diagnostic qui nomme la mauvaise règle fait perdre du temps avec autorité :
 * un gérant à qui l'on dit « plafond du magasin » alors que c'est un rayon qui
 * plafonne modifie le magasin, relance, et retombe sur le même refus.
 */
export type PlanningDailyCapSourceV3 =
  | "contract"
  | "sector"
  | "settings"
  | "store"
  | "window"

/** Fenêtre et responsabilités d'un rayon pour une date. */
export interface PlanningSectorDayV3 {
  readonly date: IsoDate
  readonly closed: boolean
  readonly opensAtMinutes: number | null
  readonly closesAtMinutes: number | null
  readonly minimumOpenings: number
  readonly exactClosings: number
  /**
   * Heure de fermeture la plus tardive tolérée pour ce rayon, ce jour-là.
   *
   * Un rayon peut fermer jusqu'à `SECTOR_CLOSING_EXTENSION_MINUTES` après son
   * horaire nominal quand cela débloque le planning, sans jamais dépasser la
   * fermeture du magasin. Contraindre le fermeur à l'heure pile ne laissait
   * qu'un seul horaire possible ; cette borne en ouvre quelques-uns, sans
   * jamais permettre de fermer plus TÔT — la couverture nominale reste due.
   *
   * Égale à `closesAtMinutes` quand aucune extension n'est possible.
   */
  readonly latestCloseMinutes: number | null
}

/** Coupures propres à un rayon dans un problème multi-secteur. */
export interface PlanningSectorSplitRulesV3 {
  readonly splitShiftAllowed: boolean
  readonly minimumSplitMinutes: number | null
  readonly maximumSplitMinutes: number | null
  readonly maximumSplitsPerDay: number | null
}

/** Un rayon du problème multi-secteur. */
export interface PlanningSectorV3 {
  readonly id: string
  readonly name: string
  readonly days: readonly PlanningSectorDayV3[]
  /** Absent sur les problèmes enregistrés avant les règles multi-secteur. */
  readonly splitRules?: PlanningSectorSplitRulesV3
  readonly closingFairness?: PlanningClosingFairnessV3 | null
}

/** One calendar day of the horizon, with its opening window and daily target. */
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
  /** Preferred worked minutes for this day, all employees combined. */
  readonly budgetMinutes: number
  /** Absent means `exact`, for compatibility with persisted V3 problems. */
  readonly budgetMode?: "exact" | "target"
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
  /** Lequel des cinq plafonds a produit `maximumMinutes`. */
  readonly maximumMinutesSource?: PlanningDailyCapSourceV3
  /**
   * Heure de début IMPOSÉE, quand le salarié en déclare une.
   *
   * Distincte de `earliestStartMinutes`, qui n'est qu'une borne : une borne
   * autorise à commencer plus tard, celle-ci non. Absente pour presque tout
   * le monde, et son absence ne veut jamais dire « à l'ouverture ».
   */
  readonly fixedStartMinutes?: number
  /** Heure de fin imposée, symétriquement. */
  readonly fixedEndMinutes?: number
  /** Ce salarié doit ouvrir ce jour-là — le rayon qu'il sert, quel qu'il soit. */
  readonly mustOpen?: boolean
  /** Il doit fermer. */
  readonly mustClose?: boolean
  readonly unavailableReason?: string
}

/** One elementary demand slot: "over [start, end) this date, need N people". */
export interface PlanningDemandSlotV3 {
  readonly id: string
  /** Absent uniquement sur les anciens problèmes mono-rayon. */
  readonly sectorId?: string
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
   * Historical wire name, now interpreted as a minimum. More employees may
   * finish at closing when contracts or coverage require it.
   */
  readonly exactClosingsPerDay: number
  /**
   * Closing fairness — a SOFT policy, and the only entry here that no engine may
   * ever treat as a constraint.
   *
   * Absent means the sector declared none. Present with both flags false means
   * the manager looked and chose not to balance, which is a different fact, so
   * the two are kept distinguishable rather than collapsed into one.
   *
   * Ranked strictly below coverage: `PLANNING_OBJECTIVES_V3` puts
   * `coverage-deficit` first, and a lexicographic objective may never trade a
   * covered slot for a fairer one.
   */
  readonly closingFairness?: PlanningClosingFairnessV3 | null
}

/** How closings should be spread, and over how much history. */
export interface PlanningClosingFairnessV3 {
  readonly balanceClosings: boolean
  readonly balanceSaturdayClosings: boolean
  /** Weeks of published history the balance is measured against. */
  readonly lookbackWeeks: number
}

/**
 * One employee's closing record over the lookback window, already reduced to
 * integers.
 *
 * The solvers receive this and never a repository: reading persistence from
 * inside a solver would make it untestable, unportable to Python, and would let
 * the same problem produce different answers depending on what happened to be
 * stored. Everything a solver needs to be fair is here, in the problem.
 *
 * `opportunities` is what makes the numbers mean anything. Comparing raw
 * closings punishes whoever was present most; comparing closings PER
 * OPPORTUNITY compares how heavily each person was actually leaned on.
 */
export interface PlanningClosingHistoryV3 {
  readonly sectorId?: string
  readonly employeeId: EmployeeId
  readonly closings: number
  readonly opportunities: number
  /** Always also counted in `closings` — a Saturday closing is a closing. */
  readonly saturdayClosings: number
  readonly saturdayOpportunities: number
}

/** The complete, immutable problem. */
export interface PlanningProblemV3 {
  readonly version: PlanningProblemVersionV3
  readonly planningId: PlanningId
  readonly sectorId: string
  /** Tous les rayons planifiés. Absent sur les anciens problèmes mono-rayon. */
  readonly sectors?: readonly PlanningSectorV3[]
  readonly period: { readonly start: IsoDate; readonly end: IsoDate }
  /** Time step every start, end and duration must be a multiple of. */
  readonly timeStepMinutes: number
  readonly employees: readonly PlanningEmployeeV3[]
  readonly days: readonly PlanningDayV3[]
  readonly employeeDays: readonly PlanningEmployeeDayV3[]
  readonly demandSlots: readonly PlanningDemandSlotV3[]
  readonly rules: PlanningRulesV3
  /**
   * Closing history, per employee, over `rules.closingFairness.lookbackWeeks`.
   *
   * Absent when no fairness is switched on: a problem that will not balance
   * anything has no use for history, and carrying it would change the
   * fingerprint of a week whose answer cannot differ.
   */
  readonly closingHistory?: readonly PlanningClosingHistoryV3[]
  /** Objectives in strict lexicographic priority order. */
  readonly objectives: readonly PlanningObjectiveV3[]
}
