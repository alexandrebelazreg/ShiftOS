import { z } from "zod"

import {
  CANONICAL_TIME_STEP_MINUTES,
  CONTRACT_TYPES,
  EMPLOYEE_STATUSES,
  WEEK_DAYS,
} from "@/features/core/models"
import type { WeekDay } from "@/features/core/models"
import { timeToMinutes } from "@/features/core/shared"
import {
  EMPLOYEE_SCHEDULE_TYPES,
  SUNDAY_COMMITMENTS,
  SUNDAY_COMPENSATIONS,
  type SundayCommitment,
  type SundayCompensation,
} from "@/features/employees/types/employee.types"

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

/**
 * Optional time of day: an empty field is `null` ("aucune restriction"), never
 * "00:00". Any value that survives is a well-formed "HH:mm" on the canonical
 * step, so nothing downstream has to re-check the format.
 */
const optionalTimeOfDay = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .nullable()
    .refine((value) => value === null || timeToMinutes(value) !== null, {
      message: "Utilisez le format HH:mm",
    })
    .refine(
      (value) => value === null || (timeToMinutes(value) ?? 0) % CANONICAL_TIME_STEP_MINUTES === 0,
      { message: `Utilisez un pas de ${CANONICAL_TIME_STEP_MINUTES} minutes` }
    )
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
  scheduleType: z.enum(EMPLOYEE_SCHEDULE_TYPES).default("variable"),
  // `.default(false)` : toute fiche enregistrée avant les jours fériés doit
  // continuer à se relire, et l'absence de statut veut dire « ni l'un ni l'autre ».
  student: z.boolean().default(false),
  forfaitJour: z.boolean().default(false),
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
  // `.default(null)` so a caller that predates these fields — a seed script, an
  // older persisted payload — still parses instead of being rejected for an
  // absence that means "no restriction".
  earliestStartTime: optionalTimeOfDay.default(null),
  latestEndTime: optionalTimeOfDay.default(null),
  startTimeIsExact: z.boolean().default(false),
  endTimeIsExact: z.boolean().default(false),
  openingDays: z.array(weekDay).default([]),
  closingDays: z.array(weekDay).default([]),

  // Permanence — `.default()` partout : une fiche enregistrée avant le tour de
  // permanence doit continuer à se relire, et l'absence vaut « n'y participe pas ».
  permanence: z.boolean().default(false),
  permanencePreferredOpeningDays: z.array(weekDay).default([]),
  permanenceRequiredOpeningDays: z.array(weekDay).default([]),
  permanencePreferredClosingDays: z.array(weekDay).default([]),
  permanenceRequiredClosingDays: z.array(weekDay).default([]),

  // Dimanche — `.default()` partout, pour la même raison que la permanence :
  // une fiche enregistrée avant cet onglet doit continuer à se relire, et son
  // silence vaut « ne travaille pas le dimanche ».
  sundayWork: z.boolean().default(false),
  sundayCommitment: z.enum(SUNDAY_COMMITMENTS).default("volunteer"),
  maxSundaysPerMonth: z.coerce.number().int().min(1).max(4).default(1),
  // `""` = pas encore choisi. La contrepartie n'a pas de valeur par défaut :
  // en donner une ferait passer un oubli pour une décision.
  sundayCompensation: z.union([z.literal(""), z.enum(SUNDAY_COMPENSATIONS)]).default(""),

  // Préférences
  preferOpening: z.boolean(),
  preferClosing: z.boolean(),
  notes: z.string().trim(),
}).superRefine((value, context) => {
  if (value.contractConfirmationRequired && !value.legacyContractMinutes) {
    context.addIssue({ code: "custom", path: ["legacyContractMinutes"], message: "Confirmez explicitement 36 h 30 ou 36 h 45" })
  }
  // Only meaningful when BOTH bounds exist: one bound alone can never contradict
  // a bound that was not stated.
  const earliest = value.earliestStartTime === null ? null : timeToMinutes(value.earliestStartTime)
  const latest = value.latestEndTime === null ? null : timeToMinutes(value.latestEndTime)
  if (earliest !== null && latest !== null && earliest >= latest) {
    context.addIssue({ code: "custom", path: ["latestEndTime"], message: "L’heure de fin doit être après l’heure de début" })
  }
  // Imposer une heure qu'on n'a pas saisie ne veut rien dire : le refus
  // vaut mieux qu'une case cochée qui ne produit aucune règle.
  if (value.startTimeIsExact && earliest === null) {
    context.addIssue({ code: "custom", path: ["earliestStartTime"], message: "Indiquez l’heure de début à imposer" })
  }
  if (value.endTimeIsExact && latest === null) {
    context.addIssue({ code: "custom", path: ["latestEndTime"], message: "Indiquez l’heure de fin à imposer" })
  }
  // Un dimanche travaillé se rend d'une des trois façons — toujours. C'est la
  // seule règle du dimanche qui bloque : le reste (plafond, engagement) a une
  // valeur sensée par défaut, une contrepartie manquante n'en a aucune, et
  // c'est celle qui se réclamera sur la fiche de paie.
  //
  // Rien n'est exigé du dimanche resté en repos fixe : c'est l'usage de la
  // maison, et un volontaire y est appelé sans que ce repos soit levé.
  if (value.sundayWork && !value.sundayCompensation) {
    context.addIssue({ code: "custom", path: ["sundayCompensation"], message: "Choisissez ce que le dimanche lui rend" })
  }
  // Ouvrir et fermer le même jour est possible ; l'être et se reposer, non.
  // Chaque champ porte son propre message : renvoyer une faute de fermeture
  // sur le champ d'ouverture désigne la mauvaise ligne à corriger.
  //
  // Les jours de permanence IMPOSÉS subissent le même contrôle, et eux seuls :
  // un jour seulement PRÉFÉRÉ qui tombe sur un repos ne sera jamais retenu par
  // le générateur, ce qui est sans conséquence — refuser la fiche pour cela
  // ferait perdre un réglage inoffensif.
  for (const [field, days] of [
    ["openingDays", value.openingDays],
    ["closingDays", value.closingDays],
    ["permanenceRequiredOpeningDays", value.permanenceRequiredOpeningDays],
    ["permanenceRequiredClosingDays", value.permanenceRequiredClosingDays],
  ] as const) {
    for (const day of days) {
      if (value.fixedDaysOff.includes(day) || value.forbiddenDays.includes(day)) {
        context.addIssue({ code: "custom", path: [field], message: `Ce salarié ne travaille pas le ${day === "monday" ? "lundi" : day === "tuesday" ? "mardi" : day === "wednesday" ? "mercredi" : day === "thursday" ? "jeudi" : day === "friday" ? "vendredi" : day === "saturday" ? "samedi" : "dimanche"}` })
        break
      }
    }
  }
}).transform(({ weeklyMinuteRemainder, contractConfirmationRequired, legacyContractMinutes, ...value }) => {
  const weeklyMinutes = contractConfirmationRequired ? Number(legacyContractMinutes) : value.weeklyHours * 60 + weeklyMinuteRemainder
  // Retirer le droit d'ouvrir retire les jours d'ouverture imposés. Sans cela
  // un réglage devenu invisible dans l'écran continuerait de contraindre le
  // solveur, et le refus tomberait sur un champ que personne ne voit.
  // Retirer quelqu'un du tour de permanence retire ses jours de permanence,
  // pour la même raison : un réglage devenu invisible à l'écran continuerait
  // d'imposer des fermetures à quelqu'un qui n'y participe plus.
  const permanenceDays = value.permanence
    ? {
        permanencePreferredOpeningDays: value.permanencePreferredOpeningDays,
        permanenceRequiredOpeningDays: value.permanenceRequiredOpeningDays,
        permanencePreferredClosingDays: value.permanencePreferredClosingDays,
        permanenceRequiredClosingDays: value.permanenceRequiredClosingDays,
      }
    : {
        permanencePreferredOpeningDays: [],
        permanenceRequiredOpeningDays: [],
        permanencePreferredClosingDays: [],
        permanenceRequiredClosingDays: [],
      }

  // Idem pour le dimanche : décocher « travaille le dimanche » ramène tout à
  // neutre. Sinon un « 3 dimanches par mois » survivrait à l'accord qui le
  // justifiait, et le premier appelant qui oublierait de vérifier `sundayWork`
  // appellerait quelqu'un qui n'a jamais accepté aucun dimanche.
  //
  // `maxSundaysPerMonth` est un PLAFOND, et `null` dit « aucun » : c'est ce que
  // vaut « tous les dimanches », où il n'y a rien à plafonner. Un 4 y aurait
  // menti les mois de cinq dimanches.
  const sunday: {
    sundayCommitment: SundayCommitment
    maxSundaysPerMonth: number | null
    sundayCompensation: SundayCompensation | null
  } = value.sundayWork
    ? {
        sundayCommitment: value.sundayCommitment,
        maxSundaysPerMonth:
          value.sundayCommitment === "fixed" ? null : value.maxSundaysPerMonth,
        // Non vide : le refus ci-dessus n'a laissé passer que ce cas.
        sundayCompensation: value.sundayCompensation || null,
      }
    : {
        sundayCommitment: "volunteer",
        maxSundaysPerMonth: null,
        sundayCompensation: null,
      }

  return {
    ...value,
    openingDays: value.canOpen ? value.openingDays : [],
    closingDays: value.canClose ? value.closingDays : [],
    ...permanenceDays,
    ...sunday,
    weeklyMinutes,
    weeklyHours: weeklyMinutes / 60,
  }
})

/** Validated, coerced employee draft (no identity / timestamps yet). */
type ParsedEmployeeDraft = z.infer<typeof employeeSchema>
export type EmployeeDraft = Omit<
  ParsedEmployeeDraft,
  | "weeklyMinutes"
  | "earliestStartTime"
  | "latestEndTime"
  | "startTimeIsExact"
  | "endTimeIsExact"
  | "openingDays"
  | "closingDays"
  | "scheduleType"
  | "student"
  | "forfaitJour"
  | "permanence"
  | "permanencePreferredOpeningDays"
  | "permanenceRequiredOpeningDays"
  | "permanencePreferredClosingDays"
  | "permanenceRequiredClosingDays"
  | "sundayWork"
  | "sundayCommitment"
  | "maxSundaysPerMonth"
  | "sundayCompensation"
> & {
  weeklyMinutes?: number | null
  /** Optional for callers and persisted drafts created before this preference existed. */
  scheduleType?: "variable" | "fixed"
  /** Idem : un brouillon écrit avant les jours fériés reste valide. */
  student?: boolean
  forfaitJour?: boolean
  /** Optional so every draft written before the advanced constraints still compiles. */
  earliestStartTime?: string | null
  latestEndTime?: string | null
  /** Idem : un brouillon écrit avant ces règles fixes reste valide. */
  startTimeIsExact?: boolean
  endTimeIsExact?: boolean
  openingDays?: WeekDay[]
  closingDays?: WeekDay[]
  /** Idem : un brouillon écrit avant le tour de permanence reste valide. */
  permanence?: boolean
  permanencePreferredOpeningDays?: WeekDay[]
  permanenceRequiredOpeningDays?: WeekDay[]
  permanencePreferredClosingDays?: WeekDay[]
  permanenceRequiredClosingDays?: WeekDay[]
  /** Idem : un brouillon écrit avant l'onglet Dimanche reste valide. */
  sundayWork?: boolean
  sundayCommitment?: SundayCommitment
  maxSundaysPerMonth?: number | null
  sundayCompensation?: SundayCompensation | null
}
