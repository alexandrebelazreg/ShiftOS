import { z } from "zod"

import {
  ABSENCE_MOTIVES,
  absenceMotiveDefinition,
} from "@/features/absences/models/absence-motive"
import { DAY_HALVES } from "@/features/absences/types/absence-record"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * La saisie d'une absence.
 *
 * Le schéma prend AUJOURD'HUI en paramètre plutôt que de lire l'horloge :
 * la limite de saisie rétroactive est une règle métier — le mois en cours et le
 * précédent, au-delà la paie est passée — et une règle qui dépend de l'heure
 * qu'il est ne se teste pas deux fois de la même façon.
 */
export function absenceFormSchema(today: string) {
  return z
    .object({
      employeeId: z.string().min(1, "Choisissez un salarié"),
      type: z.enum(ABSENCE_MOTIVES),
      start: z.string().regex(ISO_DATE, "Indiquez une date de début"),
      /**
       * Toujours saisie. Le papier la porte ; ce qu'on ignore, c'est s'il y
       * aura une prolongation — et une prolongation se saisit le jour où elle
       * arrive, en repoussant cette date depuis le détail de l'absence.
       */
      end: z.string().regex(ISO_DATE, "Indiquez une date de fin"),
      halfDay: z.union([z.literal(""), z.enum(DAY_HALVES)]).default(""),
      hours: z.string().default(""),
      note: z.string().trim().default(""),
    })
    .superRefine((value, context) => {
      const definition = absenceMotiveDefinition(value.type)

      if (ISO_DATE.test(value.end) && value.end < value.start) {
        context.addIssue({ code: "custom", path: ["end"], message: "La fin doit suivre le début" })
      }

      // Le passé, jusqu'au premier jour du mois précédent : un arrêt reçu avec
      // trois semaines de retard doit s'enregistrer à sa vraie date, une absence
      // d'il y a huit mois ne se corrige plus.
      const floor = firstDayOfPreviousMonth(today)
      if (value.start < floor) {
        context.addIssue({
          code: "custom",
          path: ["start"],
          message: `Saisie limitée au mois en cours et au précédent (depuis le ${frenchDay(floor)})`,
        })
      }

      const oneDay = value.end === value.start

      if (definition.countedInHours) {
        const hours = Number(value.hours.replace(",", "."))
        if (!Number.isFinite(hours) || hours <= 0) {
          context.addIssue({ code: "custom", path: ["hours"], message: "Indiquez un nombre d’heures" })
        } else if (hours > 24) {
          context.addIssue({ code: "custom", path: ["hours"], message: "Une journée ne fait pas plus de 24 h" })
        }
        // Des heures prises « du 3 au 12 » ne veulent rien dire : on ne saurait
        // pas de quel jour elles sortent, ni comment les décompter.
        if (!oneDay) {
          context.addIssue({ code: "custom", path: ["end"], message: "Les heures se prennent sur une seule journée" })
        }
      }

      if (value.halfDay !== "" && !oneDay) {
        context.addIssue({
          code: "custom",
          path: ["halfDay"],
          message: "Une demi-journée ne se saisit que sur une journée unique",
        })
      }

      // « Autre » sans précision est un motif qui ne dit rien : on le retrouvera
      // dans un compteur six mois plus tard sans pouvoir le nommer.
      if (definition.needsDetail && value.note.length === 0) {
        context.addIssue({ code: "custom", path: ["note"], message: "Précisez le motif" })
      }
    })
    .transform((value) => ({
      employeeId: value.employeeId,
      type: value.type,
      start: value.start,
      end: value.end,
      halfDay: value.halfDay === "" ? undefined : value.halfDay,
      hours: absenceMotiveDefinition(value.type).countedInHours
        ? Number(value.hours.replace(",", "."))
        : undefined,
      note: value.note.length > 0 ? value.note : undefined,
    }))
}

/** Le premier jour du mois précédant celui de `today`. */
export function firstDayOfPreviousMonth(today: string): string {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  return `${previous.year}-${String(previous.month).padStart(2, "0")}-01`
}

function frenchDay(date: string): string {
  const [year, month, day] = date.split("-")
  return `${day}/${month}/${year}`
}

export type AbsenceFormValues = {
  employeeId: string
  type: (typeof ABSENCE_MOTIVES)[number]
  start: string
  end: string
  halfDay: "" | "morning" | "afternoon"
  hours: string
  note: string
}
