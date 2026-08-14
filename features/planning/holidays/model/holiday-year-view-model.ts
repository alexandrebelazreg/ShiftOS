import type { IsoDate, WeekDay } from "@/features/core/models"
import { WEEK_DAY_LABELS, MONTH_LABELS, nameWithUppercaseFamily } from "@/features/planning/board/model/labels"
import type { StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { holidayProfileOf } from "@/features/planning/holidays/model/employee-holiday-profile"
import { frenchHolidaysOf } from "@/features/planning/holidays/model/french-holidays"
import {
  defaultHolidaySchedules,
  holidayScheduleWarnings,
  isSunday,
  type HolidayOpening,
  type HolidaySchedule,
  type HolidayScheduleWarning,
} from "@/features/planning/holidays/model/holiday-schedule"

/**
 * L'année des jours fériés telle que l'écran la rend.
 *
 * Tout est précalculé ici — libellés, horaires effectifs, comptes de
 * volontaires, avertissements — pour que le composant ne fasse que lire, comme
 * le board. La règle qui décide qu'un étudiant est en horaires fixes vit dans
 * `holidayProfileOf` et pas dans une case cochée à l'écran, donc la colonne
 * « type d'horaire » dit la VÉRITÉ appliquée, pas la saisie.
 */

export interface HolidayEmployeeInput {
  readonly id: string
  readonly name: string
  readonly scheduleType?: "variable" | "fixed"
  readonly student?: boolean
  readonly forfaitJour?: boolean
  readonly active: boolean
}

export interface HolidayVolunteerVM {
  readonly employeeId: string
  readonly name: string
  /** « Horaires fixes », et « (étudiant) » quand c'est le statut qui l'impose. */
  readonly scheduleLabel: string
  readonly volunteer: boolean
}

export interface HolidayDayVM {
  readonly date: IsoDate
  readonly name: string
  /** « Lundi 1 janvier » — le jour de la semaine d'abord, il décide de tout. */
  readonly dateLabel: string
  readonly sunday: boolean
  readonly opening: HolidayOpening
  readonly opensAt: string | null
  readonly closesAt: string | null
  /** Un jour chômé n'a personne à recruter : la liste ne s'ouvre pas. */
  readonly acceptsVolunteers: boolean
  readonly volunteers: readonly HolidayVolunteerVM[]
  readonly volunteerCountLabel: string
  /** Ce que le magasin fera ce jour-là, en une phrase. */
  readonly openingLabel: string
}

export interface HolidayYearVM {
  readonly year: number
  readonly years: readonly number[]
  readonly days: readonly HolidayDayVM[]
  readonly warnings: readonly HolidayScheduleWarning[]
  /** Le nombre de fériés ouverts, pour le titre. */
  readonly openCount: number
}

export interface HolidayYearInput {
  readonly year: number
  readonly stored: StoredHolidays
  readonly employees: readonly HolidayEmployeeInput[]
  /** Les horaires habituels du magasin pour cette date, s'il en a. */
  readonly usualHours: (date: IsoDate) => { readonly opensAt: string; readonly closesAt: string } | null
}

/** Combien d'années le sélecteur propose, à partir de l'année en cours. */
const YEAR_SPAN = 5

export function buildHolidayYear(input: HolidayYearInput): HolidayYearVM {
  const schedules = resolveSchedules(input.year, input.stored, input.usualHours)
  // Seuls les salariés actifs peuvent se porter volontaires : proposer une
  // fiche désactivée reviendrait à recruter quelqu'un qui n'est plus là.
  const roster = input.employees.filter((employee) => employee.active)

  const days: HolidayDayVM[] = schedules.map((schedule) => {
    const stored = input.stored[schedule.date]
    const volunteerIds = new Set(stored?.volunteerIds ?? [])
    const acceptsVolunteers = schedule.opening !== "chome"
    return {
      date: schedule.date,
      name: schedule.name,
      dateLabel: longDateLabel(schedule.date),
      sunday: isSunday(schedule.date),
      opening: schedule.opening,
      opensAt: schedule.opensAt,
      closesAt: schedule.closesAt,
      acceptsVolunteers,
      volunteers: acceptsVolunteers
        ? roster.map((employee) => {
            const profile = holidayProfileOf(employee)
            return {
              employeeId: employee.id,
              name: nameWithUppercaseFamily(employee.name),
              scheduleLabel: scheduleLabelOf(profile),
              volunteer: volunteerIds.has(employee.id),
            }
          })
        : [],
      volunteerCountLabel: acceptsVolunteers
        ? volunteerCountLabel(roster.filter((employee) => volunteerIds.has(employee.id)).length)
        : "—",
      openingLabel: openingLabelOf(schedule),
    }
  })

  return {
    year: input.year,
    years: Array.from({ length: YEAR_SPAN }, (_, index) => input.year - 1 + index),
    days,
    warnings: holidayScheduleWarnings(schedules),
    openCount: days.filter((day) => day.acceptsVolunteers).length,
  }
}

/**
 * Le calendrier réglé : les propositions par défaut, écrasées par ce que le
 * gérant a explicitement changé — et par cela seulement.
 */
export function resolveSchedules(
  year: number,
  stored: StoredHolidays,
  usualHours: HolidayYearInput["usualHours"]
): readonly HolidaySchedule[] {
  return defaultHolidaySchedules(year, usualHours).map((schedule) => {
    const saved = stored[schedule.date]
    if (!saved) return schedule
    const opening = saved.opening ?? schedule.opening
    return {
      ...schedule,
      opening,
      // Un jour redevenu chômé perd ses horaires : les garder ferait réapparaître
      // une plage d'ouverture le jour où il repasserait travaillé, sans que
      // personne l'ait décidé.
      opensAt: opening === "chome" ? null : saved.opensAt ?? schedule.opensAt,
      closesAt: opening === "chome" ? null : saved.closesAt ?? schedule.closesAt,
    }
  })
}

/** Les fériés d'une année sous forme de dates, pour qui n'a besoin que d'elles. */
export function holidayDatesOf(year: number): readonly IsoDate[] {
  return frenchHolidaysOf(year).map((holiday) => holiday.date)
}

function scheduleLabelOf(profile: ReturnType<typeof holidayProfileOf>): string {
  if (profile.forfaitJour) return "Forfait jour"
  if (profile.scheduleTypeForcedByStudent) return "Horaires fixes (étudiant)"
  return profile.scheduleType === "fixed" ? "Horaires fixes" : "Horaires variables"
}

function openingLabelOf(schedule: HolidaySchedule): string {
  if (schedule.opening === "chome") return "Magasin fermé"
  const window =
    schedule.opensAt && schedule.closesAt ? `${schedule.opensAt} – ${schedule.closesAt}` : "horaires à saisir"
  return schedule.opening === "demi-chome" ? `Ouvert le matin · ${window}` : `Ouvert · ${window}`
}

function volunteerCountLabel(count: number): string {
  if (count === 0) return "Aucun volontaire"
  return `${count} volontaire${count > 1 ? "s" : ""}`
}

/** « Lundi 1 janvier » — sans l'année, qui est déjà en tête d'écran. */
function longDateLabel(date: IsoDate): string {
  const [year, month, day] = date.split("-").map(Number)
  const weekDay = WEEK_DAYS_BY_INDEX[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${WEEK_DAY_LABELS[weekDay]} ${day} ${MONTH_LABELS[month - 1]}`
}

const WEEK_DAYS_BY_INDEX: readonly WeekDay[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]
