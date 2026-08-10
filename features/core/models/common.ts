/**
 * Shared domain primitives: branded identifiers, scalar aliases, timestamps
 * and cross-entity vocabulary (week days, planning mode, granularity).
 *
 * This file is NOT an entity — it is the common foundation imported by every
 * model so identifiers and shared enums are defined exactly once.
 */

declare const __brand: unique symbol

/** Nominal typing helper: makes a primitive distinguishable by a brand tag. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B }

/**
 * Branded entity identifiers. Each is a `string` at runtime but not mutually
 * assignable at compile time, so relationships cannot be wired with the wrong
 * kind of id. Construct/cast them at the persistence boundary (future).
 */
export type OrganizationId = Brand<string, "OrganizationId">
export type StoreId = Brand<string, "StoreId">
export type EmployeeId = Brand<string, "EmployeeId">
export type ContractId = Brand<string, "ContractId">
export type CapabilityId = Brand<string, "CapabilityId">
export type ConstraintId = Brand<string, "ConstraintId">
export type PreferenceId = Brand<string, "PreferenceId">
export type PlanningRuleId = Brand<string, "PlanningRuleId">
export type ShiftTemplateId = Brand<string, "ShiftTemplateId">
export type ShiftId = Brand<string, "ShiftId">
export type PlanningId = Brand<string, "PlanningId">
export type AssignmentId = Brand<string, "AssignmentId">
export type AuditLogId = Brand<string, "AuditLogId">
export type HolidayId = Brand<string, "HolidayId">
export type AbsenceId = Brand<string, "AbsenceId">
export type AvailabilityRuleId = Brand<string, "AvailabilityRuleId">

/** ISO 8601 date-time, e.g. "2026-07-17T09:00:00.000Z". */
export type IsoDateTime = string
/** Calendar date, "YYYY-MM-DD". */
export type IsoDate = string
/** Wall-clock time of day, 24h "HH:mm". */
export type TimeString = string
/** A duration expressed in minutes. */
export type Minutes = number

/** Creation / update audit stamps carried by every persisted entity. */
export interface Timestamps {
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

/** An inclusive calendar date range `[start, end]` (both `YYYY-MM-DD`). */
export interface DateRange {
  start: IsoDate
  end: IsoDate
}

/**
 * A time-of-day interval. `endDayOffset` expresses cross-midnight intervals:
 * 0 (default) = ends the same day, 1 = ends the next day, etc.
 */
export interface TimeWindow {
  start: TimeString
  end: TimeString
  endDayOffset?: number
}

/** Days of the week (calendar order). Shared domain vocabulary. */
export const WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const
export type WeekDay = (typeof WEEK_DAYS)[number]

/**
 * How plannings are produced:
 * - `shift_library`: assemble from predefined ShiftTemplates.
 * - `dynamic`: generate shifts within configured bounds.
 */
export const PLANNING_MODES = ["shift_library", "dynamic"] as const
export type PlanningMode = (typeof PLANNING_MODES)[number]

/** Allowed time granularity (in minutes) for dynamic shift generation. */
export const TIME_GRANULARITIES = [15, 30, 60] as const
export type TimeGranularity = (typeof TIME_GRANULARITIES)[number]

/**
 * The canonical time step every time of day entered in ShiftOS must land on.
 *
 * Distinct from `TIME_GRANULARITIES`, which is how coarsely a sector may
 * GENERATE shifts: a sector planning on the hour still expresses "ne commence
 * pas avant 08:15", and a bound off this step could never be honoured exactly.
 */
export const CANONICAL_TIME_STEP_MINUTES = 15
