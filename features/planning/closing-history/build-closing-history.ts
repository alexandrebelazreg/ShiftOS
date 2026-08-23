import type { EmployeeId, IsoDate, ShiftSegment } from "@/features/core/models"
import { weeklyClosingShare } from "@/features/core/planning-v3/fairness/closing-load"
import type { PlanningRecord } from "@/features/planning/persistence/planning-record"

/**
 * Closing history — how often each employee ACTUALLY closed, and how often they
 * COULD have.
 *
 * The counts alone are useless and, worse, misleading. Someone absent three of
 * the last eight weeks closed fewer times than everyone else; rewarding them
 * with every closing of the coming week is not fairness, it is arithmetic
 * pretending to be fairness. So every closing is paired with what that person
 * OWED over the same period, and the engines compare LOADS — never raw totals.
 *
 * **L'unité est la SEMAINE.** Une semaine où fermer était possible vaut une
 * part ; le nombre de jours travaillés n'entre pas dans le dénominateur, sauf
 * en dessous de cinq jours où la part décroît. Un plafond de fermetures ne
 * retire rien non plus : il borne ce qu'on peut donner, pas ce qu'on doit.
 *
 * Read from persisted plannings and nothing else. The solvers never touch a
 * repository: they receive this already reduced to integers, which is what keeps
 * them pure, testable and portable to Python.
 */

/** One employee's closing record over the lookback window. Integers only. */
export interface ClosingHistoryEntry {
  readonly employeeId: EmployeeId
  readonly closings: number
  /**
   * Ce que cette personne DEVAIT porter sur la fenêtre, en cinquièmes.
   *
   * Une part par SEMAINE où fermer était possible, et non une occasion par
   * jour. Compter les jours faisait dépendre le dénominateur de la taille du
   * contrat : six fermetures sur dix-huit jours et deux sur six donnaient le
   * même rapport, si bien que deux personnes très inégalement sollicitées
   * étaient déclarées à égalité. La part vaut `min(5, jours au contrat)` — cinq
   * et six jours prennent la même, en dessous elle décroît.
   */
  readonly opportunities: number
  /** Saturdays closed. Always also counted in `closings`. */
  readonly saturdayClosings: number
  /** Comme `opportunities`, sur les seules semaines portant un samedi possible. */
  readonly saturdayOpportunities: number
}

export interface ClosingHistoryRequest {
  readonly records: readonly PlanningRecord[]
  readonly sectorId: string
  /** First date of the week being generated. Everything from here on is excluded. */
  readonly weekStart: IsoDate
  readonly lookbackWeeks: number
  /** The roster of the current generation; nobody else is worth counting. */
  readonly employeeIds: readonly string[]
  /** Rest required between two days, in minutes. */
  readonly minimumRestMinutes: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Only these statuses describe a week that actually happened.
 *
 * `draft` is excluded because a draft is a proposal — counting it would let an
 * abandoned generation shape the next one. `archived` is included because the
 * lifecycle is `draft → published → archived`: an archived planning was
 * published, so it happened, and dropping it would silently shorten the window
 * for exactly the oldest weeks the lookback is meant to reach.
 */
const COUNTED_STATUSES = new Set(["published", "archived"])

export function buildClosingHistory(request: ClosingHistoryRequest): readonly ClosingHistoryEntry[] {
  const roster = new Set(request.employeeIds)
  const tally = new Map<string, { closings: number; opportunities: number; saturdayClosings: number; saturdayOpportunities: number }>()
  for (const employeeId of request.employeeIds) {
    tally.set(employeeId, { closings: 0, opportunities: 0, saturdayClosings: 0, saturdayOpportunities: 0 })
  }

  for (const record of eligibleRecords(request)) {
    // UNE SEMAINE, et non des jours. Le dénominateur ne doit pas dépendre du
    // nombre de jours travaillés : compter les jours déclarait à égalité
    // quelqu'un qui avait fermé six fois et quelqu'un qui avait fermé deux fois,
    // parce que le premier avait aussi trois fois plus de jours au dénominateur.
    //
    // Le plafond hebdomadaire N'ENTRE PLUS ICI. Il borne ce qu'on peut donner à
    // quelqu'un, il ne réduit pas ce qu'on lui doit : le retirer du dénominateur
    // faisait paraître pleinement chargé un salarié plafonné à une fermeture dès
    // qu'il l'avait prise, et le sortait de la file alors qu'il était justement
    // celui qui devait rester devant.
    const openWeek = new Set<string>()
    const openSaturday = new Set<string>()

    for (const day of closingDaysOf(record, request.sectorId)) {
      for (const employeeId of roster) {
        const bucket = tally.get(employeeId)
        if (!bucket) continue
        const closed = day.closers.has(employeeId)
        // Avoir fermé prouve qu'on le pouvait. La semaine compte alors quoi que
        // dise le modèle d'éligibilité — sinon une fermeture existerait sans
        // aucune part pour la rapporter, et la charge serait incalculable.
        if (!closed && !couldHaveClosed(record, employeeId, day, request.minimumRestMinutes)) continue

        openWeek.add(employeeId)
        if (day.isSaturday) openSaturday.add(employeeId)
        if (closed) {
          bucket.closings += 1
          // A Saturday closing counts in BOTH tallies: it is a closing like any
          // other, and separately the one the Saturday rule is about. Counting
          // it only in the Saturday tally would make Saturdays free in the
          // general balance.
          if (day.isSaturday) bucket.saturdayClosings += 1
        }
      }
    }

    for (const employeeId of openWeek) {
      tally.get(employeeId)!.opportunities += shareOf(record, employeeId)
    }
    for (const employeeId of openSaturday) {
      tally.get(employeeId)!.saturdayOpportunities += shareOf(record, employeeId)
    }
  }

  return [...tally.entries()]
    .map(([employeeId, counts]) => ({ employeeId: employeeId as unknown as EmployeeId, ...counts }))
    .sort((left, right) => String(left.employeeId).localeCompare(String(right.employeeId)))
}

/**
 * La part de cette personne pour cette semaine-là.
 *
 * Lue dans le contrat tel qu'il était ENREGISTRÉ dans la semaine, et non tel
 * qu'il est aujourd'hui : quelqu'un passé de deux à cinq jours le mois dernier
 * doit voir ses anciennes semaines comptées pour ce qu'elles étaient.
 */
function shareOf(record: PlanningRecord, employeeId: string): number {
  const contract = record.state.coreInput.contracts.find(
    (entry) => String(entry.employeeId) === employeeId
  )
  return weeklyClosingShare(contract?.workingDays.length ?? 0)
}

/** Published or archived, this sector's, strictly before the generated week, inside the window. */
function eligibleRecords(request: ClosingHistoryRequest): PlanningRecord[] {
  if (request.lookbackWeeks < 1) return []
  const end = Date.parse(`${request.weekStart}T00:00:00Z`)
  const start = end - request.lookbackWeeks * 7 * DAY_MS
  if (!Number.isFinite(end)) return []

  return request.records
    .filter((record) => COUNTED_STATUSES.has(record.status))
    // A record that never recorded its sector cannot be attributed to one.
    // Excluding it is the only honest reading: guessing would let another
    // sector's closings shape this one's fairness.
    .filter((record) => (record.sectorIds ?? []).includes(request.sectorId))
    .filter((record) => {
      const periodStart = Date.parse(`${record.periodStart}T00:00:00Z`)
      const periodEnd = Date.parse(`${record.periodEnd}T00:00:00Z`)
      if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd)) return false
      // Strictly before: the week being generated is not its own history, and
      // neither is any week that overlaps it.
      return periodEnd < end && periodStart >= start
    })
    .sort((left, right) => left.periodStart.localeCompare(right.periodStart) || left.id.localeCompare(right.id))
}

interface ClosingDay {
  readonly date: IsoDate
  readonly isSaturday: boolean
  /** Minute of day the sector actually shut, as observed in the schedule. */
  readonly closesAtMinutes: number
  readonly closers: ReadonlySet<string>
}

/**
 * The days of a record, with who closed each one.
 *
 * "Closed" is read from the schedule rather than from a configured closing time:
 * the record carries the store's hours, not the sector's, and past weeks may
 * have run on hours since changed. Whoever finished last that day locked up —
 * a fact the schedule states on its own, and one that stays true however the
 * configuration has moved since.
 */
function closingDaysOf(record: PlanningRecord, sectorId: string): ClosingDay[] {
  const employeeByShift = new Map<string, string>()
  for (const assignment of record.state.assignments) {
    employeeByShift.set(String(assignment.shiftId), String(assignment.employeeId))
  }

  const byDate = new Map<string, { latest: number; closers: Set<string> }>()
  for (const shift of record.state.shifts) {
    const employeeId = employeeByShift.get(String(shift.id))
    if (employeeId === undefined) continue
    const sectorIntervals = shift.sectorAssignments?.filter((block) => block.sectorId === sectorId)
    // Migration historique : un ancien planning mono-rayon ne porte pas de
    // sous-affectations; son unique sectorId de record attribue tout le shift.
    const end = latestEndOf(sectorIntervals ?? shift.segments)
    if (end === null) continue
    const day = byDate.get(shift.date) ?? { latest: -1, closers: new Set<string>() }
    if (end > day.latest) {
      byDate.set(shift.date, { latest: end, closers: new Set([employeeId]) })
    } else if (end === day.latest) {
      day.closers.add(employeeId)
      byDate.set(shift.date, day)
    } else {
      byDate.set(shift.date, day)
    }
  }

  return [...byDate.entries()]
    .map(([date, day]) => ({
      date: date as IsoDate,
      isSaturday: new Date(`${date}T00:00:00Z`).getUTCDay() === 6,
      closesAtMinutes: day.latest,
      closers: day.closers,
    }))
    .sort((left, right) => left.date.localeCompare(right.date))
}

function latestEndOf(segments: readonly ShiftSegment[]): number | null {
  let latest: number | null = null
  for (const segment of segments) {
    const end = minutesOf(segment.endTime)
    if (end === null) continue
    const absolute = end + (segment.endDayOffset ?? 0) * 24 * 60
    latest = latest === null ? absolute : Math.max(latest, absolute)
  }
  return latest
}

function minutesOf(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [hours, minutes] = value.split(":")
  return Number(hours) * 60 + Number(minutes)
}

/**
 * Could this employee have closed that day?
 *
 * Every clause answers "was it actually possible", never "would it have been
 * nice". An opportunity nobody could have taken is not an opportunity, and
 * counting one would punish the employee it was impossible for.
 */
/**
 * Cette personne aurait-elle pu fermer CE JOUR-LÀ ?
 *
 * Sert désormais à une seule question : la semaine comptait-elle pour elle. Un
 * seul jour possible suffit, parce que l'unité d'équité est la semaine.
 */
function couldHaveClosed(
  record: PlanningRecord,
  employeeId: string,
  day: ClosingDay,
  minimumRestMinutes: number
): boolean {
  const input = record.state.coreInput
  const employee = input.employees.find((entry) => String(entry.id) === employeeId)
  // Assigned to the sector: this record is already one sector's, so being on
  // its roster IS the affectation.
  if (!employee) return false
  if (employee.status !== "active") return false
  if (!employee.capabilities.includes("CAN_CLOSE")) return false

  const weekDay = weekDayOf(day.date)
  const contract = input.contracts.find((entry) => String(entry.employeeId) === employeeId)
  if (!contract || !contract.workingDays.includes(weekDay)) return false

  const constraints = input.employeeConstraints.filter((entry) => String(entry.employeeId) === employeeId)
  if (constraints.some((entry) => (entry.type === "FIXED_DAY_OFF" || entry.type === "FORBIDDEN_DAY") && entry.day === weekDay)) {
    return false
  }
  if (input.absences.some((absence) => String(absence.employeeId) === employeeId && day.date >= absence.range.start && day.date <= absence.range.end)) {
    return false
  }
  if (input.holidays.some((holiday) => holiday.date === day.date)) return false

  const latestEnd = constraints.find((entry) => entry.type === "LATEST_END")?.value
  if (typeof latestEnd === "number" && latestEnd < day.closesAtMinutes) return false

  // Un plafond à ZÉRO est une interdiction : cette personne ne ferme jamais, la
  // semaine ne compte donc pas pour elle. Un plafond positif, en revanche, ne
  // retire plus rien — il borne ce qu'on peut lui donner, pas ce qu'on lui doit.
  const cap = constraints.find((entry) => entry.type === "MAX_CLOSINGS")?.value
  if (cap === 0) return false

  // Rest: closing at 20:00 is impossible for someone who actually started at
  // 06:00 the next morning. Checked against what they DID work, because that is
  // the only next day the week ever had.
  const nextStart = firstStartOnDate(record, employeeId, addDays(day.date, 1))
  if (nextStart !== null && nextStart + 24 * 60 - day.closesAtMinutes < minimumRestMinutes) return false

  return true
}

function firstStartOnDate(record: PlanningRecord, employeeId: string, date: IsoDate): number | null {
  const shiftIds = new Set(
    record.state.assignments
      .filter((assignment) => String(assignment.employeeId) === employeeId)
      .map((assignment) => String(assignment.shiftId))
  )
  let earliest: number | null = null
  for (const shift of record.state.shifts) {
    if (shift.date !== date || !shiftIds.has(String(shift.id))) continue
    for (const segment of shift.segments) {
      const start = minutesOf(segment.startTime)
      if (start === null) continue
      earliest = earliest === null ? start : Math.min(earliest, start)
    }
  }
  return earliest
}

const WEEK_DAY_BY_INDEX = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const

function weekDayOf(date: IsoDate) {
  return WEEK_DAY_BY_INDEX[new Date(`${date}T00:00:00Z`).getUTCDay()]
}

function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10) as IsoDate
}
