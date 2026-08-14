import type { IsoDate } from "@/features/core/models"

/**
 * Les onze jours fériés français d'une année, calculés.
 *
 * Calculés et non saisis : huit sont à date fixe, trois dépendent de Pâques, et
 * toutes les onze sont connues d'avance jusqu'à la fin des temps. Faire saisir
 * onze dates par an à un gérant, c'est onze occasions par an de se tromper d'un
 * jour sur un document qui décide qui vient travailler.
 *
 * Ce que le magasin saisit, lui, c'est ce qu'il FAIT de chacune — chômée,
 * à moitié chômée, ou travaillée, et avec quels horaires. Cela vit dans
 * `holiday-schedule.ts` : la date est un fait du calendrier, le reste est une
 * décision du magasin.
 */

export const FRENCH_HOLIDAY_KEYS = [
  "jour-de-l-an",
  "lundi-de-paques",
  "fete-du-travail",
  "victoire-1945",
  "ascension",
  "lundi-de-pentecote",
  "fete-nationale",
  "assomption",
  "toussaint",
  "armistice-1918",
  "noel",
] as const

export type FrenchHolidayKey = (typeof FRENCH_HOLIDAY_KEYS)[number]

export interface FrenchHoliday {
  readonly key: FrenchHolidayKey
  readonly name: string
  readonly date: IsoDate
}

const NAMES: Record<FrenchHolidayKey, string> = {
  "jour-de-l-an": "Jour de l’An",
  "lundi-de-paques": "Lundi de Pâques",
  "fete-du-travail": "Fête du Travail",
  "victoire-1945": "Victoire 1945",
  "ascension": "Ascension",
  "lundi-de-pentecote": "Lundi de Pentecôte",
  "fete-nationale": "Fête Nationale",
  "assomption": "Assomption",
  "toussaint": "Toussaint",
  "armistice-1918": "Armistice 1918",
  "noel": "Noël",
}

/** Les fériés de l'année, dans l'ordre du calendrier. */
export function frenchHolidaysOf(year: number): readonly FrenchHoliday[] {
  const easter = easterSunday(year)
  const dates: Record<FrenchHolidayKey, IsoDate> = {
    "jour-de-l-an": isoDate(year, 1, 1),
    "lundi-de-paques": addDays(easter, 1),
    "fete-du-travail": isoDate(year, 5, 1),
    "victoire-1945": isoDate(year, 5, 8),
    "ascension": addDays(easter, 39),
    "lundi-de-pentecote": addDays(easter, 50),
    "fete-nationale": isoDate(year, 7, 14),
    "assomption": isoDate(year, 8, 15),
    "toussaint": isoDate(year, 11, 1),
    "armistice-1918": isoDate(year, 11, 11),
    "noel": isoDate(year, 12, 25),
  }

  return FRENCH_HOLIDAY_KEYS
    .map((key) => ({ key, name: NAMES[key], date: dates[key] }))
    .sort((left, right) => left.date.localeCompare(right.date))
}

/**
 * Le dimanche de Pâques, par le comput grégorien (algorithme dit anonyme).
 *
 * Trois fériés en dépendent — Lundi de Pâques (+1), Ascension (+39), Lundi de
 * Pentecôte (+50) — et se décalent donc chaque année. C'est la seule partie de
 * ce fichier qui mérite d'être vérifiée : le reste est un almanach.
 */
export function easterSunday(year: number): IsoDate {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return isoDate(year, month, day)
}

function isoDate(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}`
}

function addDays(date: IsoDate, days: number): IsoDate {
  const [year, month, day] = date.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return isoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

function pad(value: number): string {
  return String(value).padStart(2, "0")
}
