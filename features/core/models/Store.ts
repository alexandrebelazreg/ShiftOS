import type {
  Minutes,
  OrganizationId,
  PlanningMode,
  StoreId,
  TimeGranularity,
  TimeString,
  Timestamps,
  WeekDay,
} from "@/features/core/models/common"

/**
 * Opening hours for a single day (embedded value object).
 * When `closed` is true, `opensAt` / `closesAt` are null.
 */
export interface DaySchedule {
  day: WeekDay
  closed: boolean
  opensAt: TimeString | null
  closesAt: TimeString | null
}

/** A store's weekly opening hours — expected to hold one entry per week day. */
export type OpeningHours = DaySchedule[]

/**
 * How split shifts are allowed at a store.
 * - `forbidden`: never.
 * - `exceptional`: only in exceptional cases.
 * - `allowed` / `free`: permitted within the configured bounds below.
 */
export const SPLIT_SHIFT_POLICY_KINDS = [
  "forbidden",
  "exceptional",
  "allowed",
  "free",
] as const
export type SplitShiftPolicyKind = (typeof SPLIT_SHIFT_POLICY_KINDS)[number]

/** Policies that unlock the detailed split-shift configuration (bounds). */
export const SPLIT_SHIFT_DETAIL_POLICIES: readonly SplitShiftPolicyKind[] = [
  "allowed",
  "free",
]

/**
 * Split-shift policy (embedded value object). The bound fields are only
 * meaningful for `allowed` / `free`; they are null otherwise.
 */
export interface SplitShiftPolicy {
  kind: SplitShiftPolicyKind
  minSplitDuration: Minutes | null
  maxSplitDuration: Minutes | null
  maxSplitShiftsPerWeek: number | null
}

/**
 * Planning settings (embedded value object) — HOW plannings are generated.
 * For `shift_library` mode the dynamic bounds are null; for `dynamic` mode
 * they are required.
 */
export interface PlanningSettings {
  mode: PlanningMode
  granularity: TimeGranularity | null
  minShiftDuration: Minutes | null
  /**
   * Durée maximale d'UNE TRAITE, pauses exclues — c'est ce que « shift » dit.
   *
   * Le traducteur V3 en faisait un plafond de JOURNÉE, si bien qu'un magasin
   * réglé « pas plus de 8 h d'affilée » interdisait aussi les journées de 10 h
   * coupées que la même configuration autorise par ailleurs.
   */
  maxShiftDuration: Minutes | null
  /**
   * Durée maximale d'une JOURNÉE, pauses comprises.
   *
   * Absente pour une configuration écrite avant que la distinction traverse ce
   * pont : `maxShiftDuration` reprend alors son ancien rôle de plafond
   * journalier, et rien ne bouge pour elle.
   */
  maxDailyDuration?: Minutes | null
}

/**
 * Store — a physical workplace being scheduled.
 *
 * Relationships:
 * - belongs to one Organization (`organizationId`).
 * - has many Employees (see `Employee.storeId`).
 * - has many PlanningRules, ShiftTemplates, Shifts, Plannings (child `storeId`).
 * - embeds OpeningHours, PlanningSettings and SplitShiftPolicy (value objects).
 */
export interface Store extends Timestamps {
  id: StoreId
  organizationId: OrganizationId

  name: string
  address: string
  city: string
  postalCode: string
  country: string
  /** IANA timezone, e.g. "Europe/Paris". */
  timezone: string

  openingHours: OpeningHours
  planningSettings: PlanningSettings
  splitShiftPolicy: SplitShiftPolicy
}
