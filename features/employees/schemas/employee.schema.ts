import { z } from "zod"

import {
  CONTRACT_TYPES,
  EMPLOYEE_STATUSES,
  WEEK_DAYS,
} from "@/features/core/models"

const wholeWeeklyHours = z.preprocess((value) => {
  if (typeof value !== "string") return value
  const normalized = value.trim().toLowerCase().replace(",", ".")
  const match = normalized.match(/^(\d{1,3})(?:\s*h)?$/)
  if (match) return Number(match[1])
  return normalized
}, z.coerce.number({ message: "Saisissez un nombre d’heures entier" }))

/** Optional non-negative integer input: empty string becomes `null`. */
const optionalCount = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.coerce.number().int().min(0, "Must be zero or more").nullable()
)

const weekDay = z.enum(WEEK_DAYS)

export const employeeSchema = z.object({
  // Informations
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  phone: z.string().trim(),
  email: z.union([z.literal(""), z.string().trim().email("Invalid email")]),
  status: z.enum(EMPLOYEE_STATUSES),

  // Contrat
  weeklyHours: wholeWeeklyHours
    .refine((n) => n >= 0, { message: "Must be zero or more" })
    .refine((n) => n <= 168, { message: "Cannot exceed 168 hours" }),
  weeklyMinuteRemainder: z.coerce.number().int().min(0).max(59).refine((minutes) => minutes % 15 === 0, "Utilisez un pas de 15 minutes"),
  contractConfirmationRequired: z.boolean().default(false),
  legacyContractMinutes: z.union([z.literal(""), z.literal("2190"), z.literal("2205")]).default(""),
  contractType: z.enum(CONTRACT_TYPES),
  sectors: z.array(z.string().trim().min(1)).default([]),
  competencies: z.record(z.string(), z.array(z.string())).default({}),

  // Contraintes
  canOpen: z.boolean(),
  canClose: z.boolean(),
  splitShiftAllowed: z.boolean(),
  fixedDaysOff: z.array(weekDay),
  forbiddenDays: z.array(weekDay),
  maxOpenings: optionalCount,
  maxClosings: optionalCount,

  // Préférences
  preferOpening: z.boolean(),
  preferClosing: z.boolean(),
  notes: z.string().trim(),
}).superRefine((value, context) => { if (value.contractConfirmationRequired && !value.legacyContractMinutes) context.addIssue({ code: "custom", path: ["legacyContractMinutes"], message: "Confirmez explicitement 36 h 30 ou 36 h 45" }) }).transform(({ weeklyMinuteRemainder, contractConfirmationRequired, legacyContractMinutes, ...value }) => { const weeklyMinutes = contractConfirmationRequired ? Number(legacyContractMinutes) : value.weeklyHours * 60 + weeklyMinuteRemainder; return { ...value, weeklyMinutes, weeklyHours: weeklyMinutes / 60 } })

/** Validated, coerced employee draft (no identity / timestamps yet). */
type ParsedEmployeeDraft = z.infer<typeof employeeSchema>
export type EmployeeDraft = Omit<ParsedEmployeeDraft, "weeklyMinutes"> & { weeklyMinutes?: number | null }
