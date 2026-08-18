import type { IsoDate, WeekDay } from "@/features/core/models"
import { enumerateDates, weekDayOf } from "@/features/core/shared"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { getFullName } from "@/features/employees/utils/employee.format"
import {
  absenceCoversDate,
  absenceOverlaps,
  isCancelled,
} from "@/features/absences/models/absence-period"
import { absenceMotiveDefinition } from "@/features/absences/models/absence-motive"
import type { AbsenceRecord, DayHalf } from "@/features/absences/types/absence-record"

/**
 * Le mois des absences : un salarié par ligne, un jour par colonne.
 *
 * La forme du calendrier d'équipe, et non la liste chronologique, parce que la
 * question qu'on pose à cet écran n'est presque jamais « quand Untel est-il
 * absent ? » — c'est « qui manque la semaine du 12 ? ». Trois absences le même
 * mardi se voient en une seconde sur une grille, et ne se voient pas du tout
 * dans une liste rangée par date de début.
 *
 * Le modèle est calculé ici, en dehors du rendu : c'est ce qui permet de le
 * vérifier sans navigateur, et le navigateur manque.
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

export interface AbsenceMonthDay {
  readonly date: IsoDate
  readonly weekDay: WeekDay
  /** "12" — le quantième seul : le mois est écrit une fois, en titre. */
  readonly label: string
  /** Le magasin lève-t-il le rideau ce jour-là ? Les autres se grisent. */
  readonly open: boolean
}

/** Ce qu'une case dit d'un salarié un jour donné. */
export interface AbsenceMonthCell {
  readonly date: IsoDate
  /** L'absence qui couvre ce jour, s'il y en a une. */
  readonly absence: AbsenceRecord | null
  readonly motiveLabel: string | null
  /** La moitié couverte, quand elle ne prend pas la journée entière. */
  readonly half: DayHalf | null
  /**
   * Saisie ailleurs, lisible ici mais pas modifiable — les semaines de congés
   * validées en campagne. Sans elles la grille mentirait sur qui est présent en
   * juillet ; modifiables ici, elles se contrediraient avec l'écran Congés.
   */
  readonly locked: boolean
}

export interface AbsenceMonthRow {
  readonly employeeId: string
  readonly name: string
  readonly cells: readonly AbsenceMonthCell[]
  /** Le nombre de journées absentes du mois, demi-journées comptées pour une demie. */
  readonly daysOff: number
}

export interface AbsenceMonth {
  readonly year: number
  readonly month: number
  readonly title: string
  readonly days: readonly AbsenceMonthDay[]
  readonly rows: readonly AbsenceMonthRow[]
}

/** L'origine d'une absence : saisie ici, ou reçue d'un autre écran. */
function isLocked(absence: AbsenceRecord): boolean {
  return absence.id.startsWith("validated-paid-leave:")
}

export function buildAbsenceMonth({
  year,
  month,
  employees,
  absences,
  opensOn,
  closedDates,
}: {
  readonly year: number
  readonly month: number
  readonly employees: readonly EmployeeRecord[]
  readonly absences: readonly AbsenceRecord[]
  readonly opensOn: (day: WeekDay) => boolean
  /**
   * Les journées fermées pour une autre raison que le jour de la semaine — un
   * férié chômé. Grisées comme un jour de fermeture : personne n'y est attendu,
   * donc personne n'y manque, et y compter des absences ferait apparaître une
   * équipe entière absente le 1er mai.
   */
  readonly closedDates?: ReadonlySet<IsoDate>
}): AbsenceMonth {
  const first = `${year}-${String(month).padStart(2, "0")}-01` as IsoDate
  const last = lastDayOf(year, month)
  const dates = enumerateDates(first, last)

  const days = dates.map((date) => {
    const weekDay = weekDayOf(date)
    return {
      date,
      weekDay,
      label: String(Number(date.slice(8, 10))),
      open: opensOn(weekDay) && !(closedDates?.has(date) ?? false),
    }
  })

  // Les absences annulées ne sont pas filtrées ici : `absenceCoversDate` les
  // ignore déjà, et une seconde règle au même endroit finirait par diverger.
  const rows = employees
    .map((employee) => {
      const own = absences.filter((absence) => absence.employeeId === employee.id)
      const cells = days.map((day) => toCell(own, day.date))
      return {
        employeeId: employee.id,
        name: getFullName(employee),
        cells,
        daysOff: cells.reduce(
          (total, cell) =>
            cell.absence === null ? total : total + (cell.half === null ? 1 : 0.5),
          0
        ),
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, "fr"))

  return {
    year,
    month,
    title: `${MONTH_LABELS[month - 1]} ${year}`,
    days,
    rows,
  }
}

function toCell(absences: readonly AbsenceRecord[], date: IsoDate): AbsenceMonthCell {
  const absence = absences.find((candidate) => absenceCoversDate(candidate, date)) ?? null
  if (absence === null) {
    return { date, absence: null, motiveLabel: null, half: null, locked: false }
  }
  return {
    date,
    absence,
    motiveLabel: absenceMotiveDefinition(absence.type).label,
    half: absence.halfDay ?? null,
    locked: isLocked(absence),
  }
}

/**
 * Le compte de l'année, motif par motif.
 *
 * Sur l'année civile et non sur douze mois glissants : c'est la maille des
 * entretiens, des primes d'assiduité et de tout ce qu'on compare d'une année à
 * l'autre. Une demi-journée compte pour une demie — un compteur qui arrondirait
 * à la journée finirait par reprocher deux jours à quelqu'un qui est parti deux
 * fois à midi.
 */
export interface AbsenceCounterLine {
  readonly type: string
  readonly label: string
  readonly days: number
  /** Les heures, pour les motifs qui se comptent ainsi — la délégation. */
  readonly hours: number
}

export function buildYearCounters(
  year: number,
  absences: readonly AbsenceRecord[]
): readonly AbsenceCounterLine[] {
  const start = `${year}-01-01` as IsoDate
  const end = `${year}-12-31` as IsoDate
  const byType = new Map<string, { days: number; hours: number }>()

  for (const absence of absences) {
    if (isCancelled(absence)) continue
    if (!absenceOverlaps(absence, start, end)) continue

    const definition = absenceMotiveDefinition(absence.type)
    const current = byType.get(absence.type) ?? { days: 0, hours: 0 }
    if (definition.countedInHours) {
      current.hours += absence.hours ?? 0
    } else {
      current.days += countedDays(absence, start, end)
    }
    byType.set(absence.type, current)
  }

  return [...byType.entries()]
    .map(([type, totals]) => ({
      type,
      label: absenceMotiveDefinition(type).label,
      days: Math.round(totals.days * 2) / 2,
      hours: Math.round(totals.hours * 10) / 10,
    }))
    .sort((left, right) => right.days - left.days || right.hours - left.hours)
}

/**
 * Les journées de l'absence tombant dans l'année, bornes comprises.
 *
 * Une absence sans fin connue s'arrête au 31 décembre pour le compte : lui
 * prêter une durée infinie ferait un compteur qui grandit tout seul, et un
 * arrêt ouvert n'est pas encore un arrêt long.
 */
function countedDays(absence: AbsenceRecord, start: IsoDate, end: IsoDate): number {
  const from = absence.start < start ? start : (absence.start as IsoDate)
  const to = absence.end === null || absence.end > end ? end : (absence.end as IsoDate)
  if (to < from) return 0
  const days = enumerateDates(from, to).length
  return absence.halfDay !== undefined && days === 1 ? 0.5 : days
}

function lastDayOf(year: number, month: number): IsoDate {
  const date = new Date(Date.UTC(year, month, 0))
  return date.toISOString().slice(0, 10) as IsoDate
}
