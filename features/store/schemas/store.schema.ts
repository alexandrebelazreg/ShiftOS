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
const requiredNumber = (message = "Ce champ est obligatoire") =>
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
        message: "L’heure d’ouverture est obligatoire",
      })
    }
    if (!closesValid) {
      ctx.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "L’heure de fermeture est obligatoire",
      })
    }
    if (opensValid && closesValid && value.closesAt <= value.opensAt) {
      ctx.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "L’heure de fermeture doit être postérieure à l’heure d’ouverture",
      })
    }
  })

export const storeSchema = z
  .object({
    // Section 1 — Store information
    name: z.string().trim().min(1, "Le nom du magasin est obligatoire"),
    brand: z.string().trim().optional(),
    address: z.string().trim().min(1, "L’adresse est obligatoire"),
    city: z.string().trim().min(1, "La ville est obligatoire"),
    postalCode: z.string().trim().min(1, "Le code postal est obligatoire"),
    country: z.string().trim().min(1, "Le pays est obligatoire"),
    timezone: z.string().trim().min(1, "Le fuseau horaire est obligatoire"),

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
    minDailyHours: requiredNumber("Le minimum journalier est obligatoire"),
    maxDailyHours: requiredNumber("Le maximum journalier avec coupure est obligatoire"),
    minRestBetweenShifts: requiredNumber("Le repos minimum est obligatoire"),
    maxWeeklyHoursOverride: optionalNumber,
  })
  .superRefine((data, ctx) => {
    // Section 3 — dynamic mode requires shift bounds + granularity
    if (data.planningMode === "dynamic") {
      if (data.minShiftDuration === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["minShiftDuration"],
          message: "Cette durée est obligatoire pour la génération automatique",
        })
      }
      if (data.maxShiftDuration === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["maxShiftDuration"],
          message: "Le maximum en continu est obligatoire pour la génération automatique",
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
          message: "Le maximum doit être supérieur ou égal au minimum",
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
          message: "Sélectionnez une précision horaire",
        })
      }
    }

    // Section 4 — allowed/free unlock split-shift bounds
    if (SPLIT_SHIFT_DETAIL_POLICIES.includes(data.splitShiftPolicy)) {
      if (data.minSplitDuration === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["minSplitDuration"],
          message: "La coupure minimale est obligatoire",
        })
      }
      if (data.maxSplitDuration === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["maxSplitDuration"],
          message: "La coupure maximale est obligatoire",
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
          message: "La coupure maximale doit être supérieure ou égale à la coupure minimale",
        })
      }
      if (data.maxSplitShiftsPerWeek === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["maxSplitShiftsPerWeek"],
          message: "Le nombre maximal de journées avec coupure est obligatoire",
        })
      }
    }

    // Section 5 — cross-field sanity
    if (data.maxDailyHours < data.minDailyHours) {
      ctx.addIssue({
        code: "custom",
        path: ["maxDailyHours"],
        message: "Le maximum journalier avec coupure doit être supérieur ou égal au minimum journalier",
      })
    }

    if (
      data.maxShiftDuration !== undefined &&
      data.maxDailyHours * 60 < data.maxShiftDuration
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["maxDailyHours"],
        message: "Le maximum avec coupure doit être supérieur ou égal au maximum en continu",
      })
    }
  })

/** Validated, coerced store configuration produced on submit. */
export type StoreConfig = z.infer<typeof storeSchema>
