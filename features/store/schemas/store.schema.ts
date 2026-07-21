import { z } from "zod"

import {
  PLANNING_MODES,
  SPLIT_SHIFT_DETAIL_POLICIES,
  SPLIT_SHIFT_POLICY_KINDS,
  TIME_GRANULARITIES,
  WEEK_DAYS,
} from "@/features/core/models"

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Required numeric input: rejects empty strings, coerces the rest to number. */
const requiredNumber = (message = "Required") =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? Number.NaN : v),
    z.coerce.number({ message }).refine((n) => !Number.isNaN(n), { message })
  )

/** Optional numeric input: empty string becomes `undefined`. */
const optionalNumber = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce.number().optional()
)

const dayScheduleSchema = z
  .object({
    day: z.enum(WEEK_DAYS),
    closed: z.boolean(),
    opensAt: z.string(),
    closesAt: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.closed) return

    const opensValid = TIME_RE.test(value.opensAt)
    const closesValid = TIME_RE.test(value.closesAt)

    if (!opensValid) {
      ctx.addIssue({
        code: "custom",
        path: ["opensAt"],
        message: "Opening hour is required",
      })
    }
    if (!closesValid) {
      ctx.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "Closing hour is required",
      })
    }
    if (opensValid && closesValid && value.closesAt <= value.opensAt) {
      ctx.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "Closing hour must be after opening hour",
      })
    }
  })

export const storeSchema = z
  .object({
    // Section 1 — Store information
    name: z.string().trim().min(1, "Store name is required"),
    brand: z.string().trim().optional(),
    address: z.string().trim().min(1, "Address is required"),
    city: z.string().trim().min(1, "City is required"),
    postalCode: z.string().trim().min(1, "Postal code is required"),
    country: z.string().trim().min(1, "Country is required"),
    timezone: z.string().trim().min(1, "Timezone is required"),

    // Section 2 — Opening hours
    openingHours: z.array(dayScheduleSchema).length(WEEK_DAYS.length),

    // Section 3 — Planning mode
    planningMode: z.enum(PLANNING_MODES),
    minShiftDuration: optionalNumber,
    maxShiftDuration: optionalNumber,
    timeGranularity: optionalNumber,

    // Section 4 — Split shift policy
    splitShiftPolicy: z.enum(SPLIT_SHIFT_POLICY_KINDS),
    minSplitDuration: optionalNumber,
    maxSplitDuration: optionalNumber,
    maxSplitShiftsPerWeek: optionalNumber,

    // Section 5 — General rules
    minDailyHours: requiredNumber("Minimum daily hours is required"),
    maxDailyHours: requiredNumber("Maximum daily hours is required"),
    minRestBetweenShifts: requiredNumber("Minimum rest is required"),
    maxWeeklyHoursOverride: optionalNumber,
  })
  .superRefine((data, ctx) => {
    // Section 3 — dynamic mode requires shift bounds + granularity
    if (data.planningMode === "dynamic") {
      if (data.minShiftDuration === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["minShiftDuration"],
          message: "Required for dynamic generation",
        })
      }
      if (data.maxShiftDuration === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["maxShiftDuration"],
          message: "Required for dynamic generation",
        })
      }
      if (
        data.minShiftDuration !== undefined &&
        data.maxShiftDuration !== undefined &&
        data.maxShiftDuration < data.minShiftDuration
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["maxShiftDuration"],
          message: "Maximum must be greater than or equal to minimum",
        })
      }
      if (
        data.timeGranularity === undefined ||
        !TIME_GRANULARITIES.includes(
          data.timeGranularity as (typeof TIME_GRANULARITIES)[number]
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["timeGranularity"],
          message: "Select a granularity",
        })
      }
    }

    // Section 4 — allowed/free unlock split-shift bounds
    if (SPLIT_SHIFT_DETAIL_POLICIES.includes(data.splitShiftPolicy)) {
      if (data.minSplitDuration === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["minSplitDuration"],
          message: "Required for this policy",
        })
      }
      if (data.maxSplitDuration === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["maxSplitDuration"],
          message: "Required for this policy",
        })
      }
      if (
        data.minSplitDuration !== undefined &&
        data.maxSplitDuration !== undefined &&
        data.maxSplitDuration < data.minSplitDuration
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["maxSplitDuration"],
          message: "Maximum must be greater than or equal to minimum",
        })
      }
      if (data.maxSplitShiftsPerWeek === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["maxSplitShiftsPerWeek"],
          message: "Required for this policy",
        })
      }
    }

    // Section 5 — cross-field sanity
    if (data.maxDailyHours < data.minDailyHours) {
      ctx.addIssue({
        code: "custom",
        path: ["maxDailyHours"],
        message: "Maximum must be greater than or equal to minimum",
      })
    }
  })

/** Validated, coerced store configuration produced on submit. */
export type StoreConfig = z.infer<typeof storeSchema>
