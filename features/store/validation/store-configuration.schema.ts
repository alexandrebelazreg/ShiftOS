import { z } from "zod"

import { PLANNING_MODES, WEEK_DAYS } from "@/features/core/models"

/** 24h "HH:mm". Defined once and reused by every time field (no duplication). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const timeString = z.string().regex(TIME_RE, "Invalid time, expected HH:mm")
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date, expected YYYY-MM-DD")

const minutes = z.number().int().nonnegative()
const positiveMinutes = z.number().int().positive()
const weight = z.number().nonnegative()
const unitInterval = z.number().min(0).max(1)

const generalSchema = z.object({
  name: z.string().trim().min(1, "Store name is required"),
  timezone: z.string().trim().min(1, "Timezone is required"),
  country: z.string().trim().min(1, "Country is required"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code"),
  weekStart: z.enum(WEEK_DAYS),
})

const timeRangeSchema = z
  .object({ start: timeString, end: timeString })
  .refine((r) => r.end > r.start, {
    path: ["end"],
    message: "Range end must be after its start",
  })

const dayOpeningHoursSchema = z
  .object({
    day: z.enum(WEEK_DAYS),
    closed: z.boolean(),
    ranges: z.array(timeRangeSchema),
  })
  .superRefine((value, ctx) => {
    if (value.closed) return
    if (value.ranges.length === 0) {
      ctx.addIssue({ code: "custom", path: ["ranges"], message: "An open day needs at least one range" })
      return
    }
    // Ranges must not overlap (checked in chronological order).
    const sorted = [...value.ranges].sort((a, b) => (a.start < b.start ? -1 : 1))
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start < sorted[i - 1].end) {
        ctx.addIssue({ code: "custom", path: ["ranges"], message: "Opening ranges must not overlap" })
        break
      }
    }
  })

const openingHoursSchema = z
  .array(dayOpeningHoursSchema)
  .length(WEEK_DAYS.length, "Opening hours must cover every weekday")

const planningSettingsSchema = z
  .object({
    mode: z.enum(PLANNING_MODES),
    granularity: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    minShiftDuration: positiveMinutes,
    maxShiftDuration: positiveMinutes,
  })
  .refine((p) => p.maxShiftDuration >= p.minShiftDuration, {
    path: ["maxShiftDuration"],
    message: "Maximum shift duration must be ≥ the minimum",
  })

const shiftSettingsSchema = z
  .object({
    minRestBetweenShifts: minutes,
    minDailyDuration: minutes,
    maxDailyDuration: positiveMinutes,
    maxWeeklyDuration: positiveMinutes,
    contractToleranceMinutes: minutes,
  })
  .refine((s) => s.maxDailyDuration >= s.minDailyDuration, {
    path: ["maxDailyDuration"],
    message: "Maximum daily duration must be ≥ the minimum",
  })

const splitShiftSettingsSchema = z
  .object({
    enabled: z.boolean(),
    minBreak: minutes,
    maxBreak: minutes,
    maxSplitShiftsPerEmployee: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.maxBreak < value.minBreak) {
      ctx.addIssue({
        code: "custom",
        path: ["maxBreak"],
        message: "Maximum break must be ≥ the minimum break",
      })
    }
  })

const coverageRequirementTemplateSchema = z.object({
  start: timeString,
  end: timeString,
  endDayOffset: z.number().int().nonnegative().optional(),
  minEmployees: z.number().int().nonnegative(),
  maxEmployees: z.number().int().nonnegative().nullable().optional(),
  requiredCapabilities: z.array(z.string()).optional(),
})

const coverageSettingsSchema = z.object({
  defaultMinEmployeesPerShift: z.number().int().nonnegative(),
  profiles: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      requirements: z.array(coverageRequirementTemplateSchema),
    })
  ),
})

const fairnessSettingsSchema = z.object({
  weights: z.object({
    workedHours: weight,
    opening: weight,
    closing: weight,
    weekend: weight,
    preferences: weight,
  }),
  extraWeights: z.record(z.string(), weight),
  imbalanceThreshold: z.number().nonnegative(),
  warningThreshold: unitInterval,
  minCohortSize: z.number().int().min(1),
})

const scoringSettingsSchema = z.object({
  weights: z.object({
    coverage: weight,
    contract: weight,
    availability: weight,
    soft: weight,
  }),
  warningCredit: unitInterval,
  feasibilityThreshold: unitInterval,
})

const holidaySettingsSchema = z.object({
  observe: z.boolean(),
  entries: z.array(
    z.object({
      date: isoDate,
      name: z.string().min(1),
      recurringAnnually: z.boolean().optional(),
    })
  ),
})

const capabilitySettingsSchema = z.object({
  definitions: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      description: z.string().optional(),
    })
  ),
})

/**
 * storeConfigurationSchema — the SINGLE validation of a store configuration.
 * Every rule (time format, range ordering, non-overlap, min ≤ max, weight and
 * threshold bounds) is expressed once here; no consumer re-validates.
 *
 * `id` / `storeId` are unconstrained strings — identity is assigned by the
 * persistence boundary, not a planning parameter to validate here.
 */
export const storeConfigurationSchema = z.object({
  id: z.string(),
  storeId: z.string(),
  general: generalSchema,
  openingHours: openingHoursSchema,
  planning: planningSettingsSchema,
  shift: shiftSettingsSchema,
  splitShift: splitShiftSettingsSchema,
  coverage: coverageSettingsSchema,
  fairness: fairnessSettingsSchema,
  scoring: scoringSettingsSchema,
  holidays: holidaySettingsSchema,
  capabilities: capabilitySettingsSchema,
})
