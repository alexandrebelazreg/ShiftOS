import type { IsoDate, WeekDay } from "@/features/core/models"
import { WEEK_DAYS } from "@/features/core/models"
import { enumerateDates, isoWeekKey, weekDayOf } from "@/features/core/shared"

/**
 * Le squelette d'un mois de permanence : les semaines, leurs journées, et ce
 * que le magasin fait de chacune.
 *
 * Reprend la feuille Excel dans sa forme — une bande par semaine ISO, du lundi
 * au samedi, les journées des semaines à cheval montrées grisées plutôt que
 * masquées, pour que « S5 » ne paraisse pas amputée. Ce qui change : le
 * dimanche, absent de la feuille, apparaît en colonne quand le magasin ouvre ce
 * jour-là — sinon on ne saurait pas où poser un dimanche, ni comment le compter.
 *
 * Aucune affectation ici. Ce fichier ne dit que ce que le calendrier impose ;
 * qui vient est l'affaire du générateur.
 */

export const MONTH_LABELS: readonly string[] = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
]

/** Ce qu'est un jour férié pour le tour de permanence, et rien de plus. */
export interface PermanenceHoliday {
  readonly name: string
  /** Chômé : le rideau reste baissé, il n'y a ni ouverture ni fermeture. */
  readonly closed: boolean
}

export interface PermanenceDay {
  readonly date: IsoDate
  readonly weekDay: WeekDay
  /** "1/01" — comme sur la feuille. */
  readonly label: string
  /** Faux pour les journées des semaines à cheval : elles sont montrées, jamais remplies. */
  readonly inMonth: boolean
  /** Le magasin lève-t-il le rideau ce jour-là ? */
  readonly open: boolean
  /** Pourquoi il ne l'ouvre pas — « Fermé », ou le nom du férié chômé. */
  readonly closedLabel: string | null
  /** Le nom du férié, chômé ou non : un jour travaillé le porte aussi. */
  readonly holidayName: string | null
}

export interface PermanenceWeek {
  /** "2026-W02" — la clé sous laquelle congés et astreinte sont conservés. */
  readonly key: string
  /** Le numéro affiché en tête de bande : « S2 ». */
  readonly number: number
  readonly days: readonly PermanenceDay[]
}

export interface PermanenceCalendar {
  readonly year: number
  readonly month: number
  /** « Janvier 2026 ». */
  readonly label: string
  /** Les colonnes de la grille : lundi→samedi, et dimanche si le magasin ouvre. */
  readonly weekDays: readonly WeekDay[]
  readonly weeks: readonly PermanenceWeek[]
  /** Les journées ouvrées du mois, dans l'ordre — ce que le générateur a à remplir. */
  readonly openDays: readonly PermanenceDay[]
}

export interface PermanenceCalendarInput {
  readonly year: number
  /** 1 à 12. */
  readonly month: number
  /** Le magasin ouvre-t-il habituellement ce jour de la semaine ? */
  readonly opensOn: (day: WeekDay) => boolean
  /** Le férié de cette date, s'il y en a un. */
  readonly holidayOf: (date: IsoDate) => PermanenceHoliday | null
}

export function buildPermanenceCalendar(input: PermanenceCalendarInput): PermanenceCalendar {
  const { year, month, opensOn, holidayOf } = input

  // Les colonnes. Le dimanche n'apparaît que si le magasin ouvre ce jour-là :
  // une colonne vide toute l'année serait une invitation à y écrire quelque
  // chose. Les six autres restent, même fermées — un lundi de fermeture se lit
  // mieux barré qu'absent.
  const weekDays = WEEK_DAYS.filter((day) => day !== "sunday" || opensOn("sunday"))

  const first = isoDate(year, month, 1)
  const last = isoDate(year, month, daysInMonth(year, month))
  const dates = enumerateDates(mondayOf(first), sundayOf(last))

  const byWeek = new Map<string, PermanenceDay[]>()
  for (const date of dates) {
    const weekDay = weekDayOf(date)
    if (!weekDays.includes(weekDay)) continue

    const holiday = holidayOf(date)
    // Un férié ne peut que FERMER une journée déjà ouverte, jamais en ouvrir
    // une. Le calendrier des fériés propose « travaillé » pour tout dimanche
    // férié, y compris dans un magasin qui n'ouvre jamais le dimanche — ce
    // n'est pas une prédiction d'ouverture, et la lire comme telle inventerait
    // une permanence rideau baissé.
    const openable = date >= first && date <= last && opensOn(weekDay)
    const open = openable && !(holiday?.closed ?? false)

    const day: PermanenceDay = {
      date,
      weekDay,
      label: dayLabel(date),
      inMonth: date >= first && date <= last,
      open,
      closedLabel: closedLabel({ date, first, last, opensDay: opensOn(weekDay), holiday }),
      holidayName: holiday?.name ?? null,
    }

    const key = isoWeekKey(date)
    const bucket = byWeek.get(key)
    if (bucket) bucket.push(day)
    else byWeek.set(key, [day])
  }

  const weeks: PermanenceWeek[] = [...byWeek.entries()].map(([key, days]) => ({
    key,
    number: Number(key.slice(key.indexOf("W") + 1)),
    days,
  }))

  return {
    year,
    month,
    label: `${MONTH_LABELS[month - 1]} ${year}`,
    weekDays,
    weeks,
    openDays: weeks.flatMap((week) => week.days.filter((day) => day.open)),
  }
}

/**
 * Ce qui est écrit dans une case qu'on ne peut pas remplir. `null` quand la
 * journée est ouverte : elle attend alors un nom, pas une explication.
 */
function closedLabel(input: {
  readonly date: IsoDate
  readonly first: IsoDate
  readonly last: IsoDate
  readonly opensDay: boolean
  readonly holiday: PermanenceHoliday | null
}): string | null {
  if (input.date < input.first || input.date > input.last) return "—"
  if (input.holiday?.closed === true) return "FERMÉ"
  if (!input.opensDay) return "Fermé"
  return null
}

/** "1/01" : le jour sans zéro initial, le mois avec — comme sur la feuille. */
function dayLabel(date: IsoDate): string {
  const [, month, day] = date.split("-")
  return `${Number(day)}/${month}`
}

function isoDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function mondayOf(date: IsoDate): IsoDate {
  return shift(date, -WEEK_DAYS.indexOf(weekDayOf(date)))
}

function sundayOf(date: IsoDate): IsoDate {
  return shift(date, WEEK_DAYS.length - 1 - WEEK_DAYS.indexOf(weekDayOf(date)))
}

function shift(date: IsoDate, days: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number)
  const moved = new Date(Date.UTC(year, month - 1, day + days))
  return moved.toISOString().slice(0, 10)
}
