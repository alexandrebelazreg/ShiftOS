import type { EmployeeId, IsoDate, WeekDay } from "@/features/core/models"

import type {
  BoardDay,
  BoardShift,
  PlanningBoardInput,
  PlanningBoardSelection,
} from "@/features/planning/board/model/board-input"
import { isoWeekNumber } from "@/features/planning/board/model/week"

/**
 * The complete ViewModel the planning board renders.
 *
 * Everything a component needs is precomputed here: labels, totals, colours,
 * and — critically — the geometry of the day timeline as percentages. A React
 * component never computes a position, a coverage level or an hour count; it
 * reads a field. That is what keeps the components engine-agnostic and makes
 * them survive the V2 → V3 swap untouched.
 *
 * Both views are built from ONE filtered set of shifts, so they cannot drift
 * apart: there is no second code path to keep in sync.
 */

// ── Shared ───────────────────────────────────────────────────────────────────

/** How a figure compares to what was expected. Drives colour, nothing else. */
export type BoardLevel = "ok" | "over" | "under" | "neutral"

/**
 * What kind of day a shift is. A manager scanning the grid should see the
 * spread of openings and closings without comparing times in their head, so the
 * kind is decided once here and rendered as a colour.
 */
export type BoardShiftKind = "opening" | "closing" | "day" | "split"

export interface BoardShiftVM {
  readonly id: string
  readonly employeeId: EmployeeId
  readonly date: IsoDate
  readonly dateLabel: string
  readonly label: string
  readonly startLabel: string
  readonly endLabel: string
  readonly durationLabel: string
  readonly isSplit: boolean
  readonly opensDay: boolean
  readonly closesDay: boolean
  readonly kind: BoardShiftKind
  readonly kindLabel: string
  /** Position inside the day timeline, in percent of the open window. */
  readonly leftPercent: number
  readonly widthPercent: number
  /** One block per continuous segment, for split shifts. */
  readonly segments: readonly { readonly leftPercent: number; readonly widthPercent: number }[]
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

export interface BoardToolbarVM {
  readonly view: "sector" | "day" | "employee"
  /** ISO week number - the reference a store manager navigates by. */
  readonly weekNumber: number
  readonly weekTitle: string
  readonly rangeLabel: string
  readonly weekLabel: string
  readonly periodLabel: string
  readonly canGoPreviousWeek: boolean
  readonly canGoNextWeek: boolean
  readonly sectors: readonly { readonly id: string; readonly name: string; readonly selected: boolean }[]
  readonly days: readonly {
    readonly date: IsoDate
    readonly label: string
    readonly shortLabel: string
    readonly closed: boolean
    readonly selected: boolean
  }[]
}

// ── Sector view ──────────────────────────────────────────────────────────────

export interface BoardSectorColumnVM {
  readonly date: IsoDate
  readonly label: string
  readonly shortLabel: string
  readonly dateLabel: string
  readonly closed: boolean
}

export interface BoardSectorRowVM {
  readonly employeeId: EmployeeId
  readonly name: string
  readonly initials: string
  readonly plannedLabel: string
  readonly contractLabel: string
  readonly differenceLabel: string
  /** One line: "36 h 45 / 36 h 45". Keeps the grid rows short. */
  readonly hoursLabel: string
  /** Only set when the contract is actually missed, so it can stay hidden. */
  readonly deviationLabel: string | null
  /** True when planned equals contracted: the grid shows a tick instead. */
  readonly onTarget: boolean
  readonly level: BoardLevel
  readonly selected: boolean
  /** Shifts per date, aligned with `columns`. */
  readonly shiftsByDate: Readonly<Record<string, readonly BoardShiftVM[]>>
}

export interface BoardSectorViewVM {
  readonly columns: readonly BoardSectorColumnVM[]
  readonly rows: readonly BoardSectorRowVM[]
}

// ── Day view ─────────────────────────────────────────────────────────────────

export interface BoardHourVM {
  readonly startMinutes: number
  readonly label: string
  /** Percentage width of one hour column, so header and bars share a grid. */
  readonly widthPercent: number
}

export interface BoardCoverageCellVM {
  readonly startMinutes: number
  readonly required: number
  readonly present: number
  readonly level: BoardLevel
}

export interface BoardDayRowVM {
  readonly employeeId: EmployeeId
  readonly name: string
  readonly initials: string
  readonly selected: boolean
  readonly restLabel: string | null
  readonly shifts: readonly BoardShiftVM[]
}

export interface BoardDayViewVM {
  readonly date: IsoDate | null
  readonly dateLabel: string
  readonly closed: boolean
  readonly hours: readonly BoardHourVM[]
  readonly requiredRow: readonly BoardCoverageCellVM[]
  readonly presentRow: readonly BoardCoverageCellVM[]
  readonly rows: readonly BoardDayRowVM[]
}

// ── Employee panel ───────────────────────────────────────────────────────────

export interface BoardPanelMetricVM {
  readonly label: string
  readonly value: string
  readonly level: BoardLevel
}

// ── Employee view ──────────────────────────────────────────────

export interface BoardWeekDayVM {
  readonly date: IsoDate
  readonly dayLabel: string
  readonly dateLabel: string
  readonly closed: boolean
  readonly restLabel: string | null
  readonly totalLabel: string
  readonly shifts: readonly BoardShiftVM[]
}

export interface BoardEmployeeViewVM {
  readonly employeeId: EmployeeId
  readonly name: string
  readonly initials: string
  readonly general: readonly BoardPanelMetricVM[]
  readonly stats: readonly BoardPanelMetricVM[]
  /** One ruler for the whole week, so every day lines up. */
  readonly hours: readonly BoardHourVM[]
  readonly days: readonly BoardWeekDayVM[]
  readonly rules: readonly string[]
  readonly roster: readonly {
    readonly employeeId: EmployeeId
    readonly name: string
    readonly initials: string
    readonly selected: boolean
  }[]
}

// ── Summary ───────────────────────────────────────────────────

export interface BoardDeficitRowVM {
  readonly key: string
  readonly dayLabel: string
  readonly hourLabel: string
  readonly required: number
  readonly present: number
}

export interface BoardSummaryVM {
  readonly status: "ok" | "reserves" | "blocked"
  readonly title: string
  readonly headline: string
  /** Only what changes a decision. Surpluses and internals stay out. */
  readonly facts: readonly { readonly label: string; readonly level: BoardLevel }[]
  readonly deficits: readonly BoardDeficitRowVM[]
  readonly technical: readonly { readonly label: string; readonly value: string }[]
}

// ── Root ─────────────────────────────────────────────────────────────────────

export interface PlanningBoardViewModel {
  readonly toolbar: BoardToolbarVM
  readonly sectorView: BoardSectorViewVM
  readonly dayView: BoardDayViewVM
  readonly employeeView: BoardEmployeeViewVM | null
  readonly summary: BoardSummaryVM
}

const WEEK_DAY_LABELS: Record<WeekDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
  sunday: "Dimanche",
}

const HOUR = 60

/**
 * Build the whole board.
 *
 * The single entry point on purpose: the sector view, the day view and the
 * side panel are three readings of ONE filtered dataset, computed together.
 * Changing week, sector or day changes the inputs to this one function, so the
 * views update in lockstep by construction rather than by discipline.
 */
export function buildPlanningBoard(
  input: PlanningBoardInput,
  selection: PlanningBoardSelection
): PlanningBoardViewModel {
  const sectorId = selection.sectorId ?? input.sectors[0]?.id ?? null
  const days = [...input.days].sort((left, right) => left.date.localeCompare(right.date))
  const openDays = days.filter((day) => !day.closed)
  const date = selection.date ?? openDays[0]?.date ?? days[0]?.date ?? null

  // ONE filtered set. Both views read it; neither re-filters.
  const shifts = input.shifts.filter((shift) => sectorId === null || shift.sectorId === sectorId)
  const employees = input.employees.filter(
    (employee) => sectorId === null || employee.sectorIds.includes(sectorId)
  )
  const demand = input.demand.filter((slot) => sectorId === null || slot.sectorId === sectorId)

  const day = days.find((item) => item.date === date) ?? null
  const open = day?.opensAtMinutes ?? null
  const close = day?.closesAtMinutes ?? null
  const span = open !== null && close !== null && close > open ? close - open : 0

  const shiftVMs = new Map<string, BoardShiftVM>()
  for (const shift of shifts) {
    shiftVMs.set(shift.id, toShiftVM(shift, shift.date === date ? open : null, shift.date === date ? span : 0))
  }

  return {
    toolbar: {
      view: selection.view,
      weekNumber: isoWeekNumber(input.periodStart),
      weekTitle: `Semaine ${isoWeekNumber(input.periodStart)}`,
      rangeLabel: `${longDate(input.periodStart)} → ${longDate(input.periodEnd)}`,
      weekLabel: weekLabel(input.periodStart, input.periodEnd),
      periodLabel: `${formatDate(input.periodStart)} – ${formatDate(input.periodEnd)}`,
      // Week navigation is owned by the caller; the board only reports that a
      // period exists on both sides.
      canGoPreviousWeek: true,
      canGoNextWeek: true,
      sectors: input.sectors.map((sector) => ({
        id: sector.id,
        name: sector.name,
        selected: sector.id === sectorId,
      })),
      days: days.map((item) => ({
        date: item.date,
        label: `${WEEK_DAY_LABELS[item.weekDay]} ${formatDate(item.date)}`,
        shortLabel: WEEK_DAY_LABELS[item.weekDay].slice(0, 3),
        closed: item.closed,
        selected: item.date === date,
      })),
    },
    sectorView: buildSectorView(employees, days, shifts, shiftVMs, selection.employeeId),
    dayView: buildDayView(employees, day, shifts, demand, open, span, selection.employeeId),
    employeeView: buildEmployeeView(employees, days, shifts, selection.employeeId),
    summary: buildSummary(input, days, employees, shifts, demand),
  }
}

// ── Employee view ──────────────────────────────────────────────

function buildEmployeeView(
  employees: PlanningBoardInput["employees"],
  days: readonly BoardDay[],
  shifts: readonly BoardShift[],
  employeeId: EmployeeId | null
): BoardEmployeeViewVM | null {
  if (employees.length === 0) return null
  const employee = employees.find((item) => item.id === employeeId) ?? employees[0]

  // ONE ruler for the whole week: the widest opening window any day uses. Days
  // scaled to their own hours would look comparable while not being so.
  const openDays = days.filter((day) => !day.closed && day.opensAtMinutes !== null)
  const open = openDays.length ? Math.min(...openDays.map((d) => d.opensAtMinutes!)) : 0
  const close = openDays.length ? Math.max(...openDays.map((d) => d.closesAtMinutes!)) : 0
  const span = close > open ? close - open : 0
  const hourCount = span > 0 ? Math.ceil(span / HOUR) : 0
  const hourWidth = hourCount > 0 ? 100 / hourCount : 0
  const hours: BoardHourVM[] = Array.from({ length: hourCount }, (_, index) => ({
    startMinutes: open + index * HOUR,
    label: clockLabel(open + index * HOUR),
    widthPercent: hourWidth,
  }))

  const own = shifts.filter((shift) => shift.employeeId === employee.id)
  const planned = own.reduce((sum, shift) => sum + shift.workedMinutes, 0)
  const difference = planned - employee.contractMinutes
  const openings = own.filter((shift) => shift.opensDay).length
  const closings = own.filter((shift) => shift.closesDay).length
  const saturdays = new Set(days.filter((d) => d.weekDay === "saturday").map((d) => d.date))
  const saturdayCount = new Set(own.filter((s) => saturdays.has(s.date)).map((s) => s.date)).size

  return {
    employeeId: employee.id,
    name: employee.name,
    initials: initialsOf(employee.name),
    general: [
      { label: "Contrat hebdomadaire", value: durationLabel(employee.contractMinutes), level: "neutral" },
      { label: "Heures planifiées", value: durationLabel(planned), level: "neutral" },
      {
        label: "Écart",
        value: signedDurationLabel(difference),
        level: difference === 0 ? "ok" : difference > 0 ? "over" : "under",
      },
    ],
    stats: [
      { label: "Ouvertures", value: String(openings), level: "neutral" },
      { label: "Fermetures", value: String(closings), level: "neutral" },
      { label: "Samedis travaillés", value: String(saturdayCount), level: "neutral" },
    ],
    hours,
    days: days.map((day) => {
      const onDay = own
        .filter((shift) => shift.date === day.date)
        .map((shift) => toShiftVM(shift, open, span))
        .sort((left, right) => left.leftPercent - right.leftPercent)
      const total = own
        .filter((shift) => shift.date === day.date)
        .reduce((sum, shift) => sum + shift.workedMinutes, 0)
      return {
        date: day.date,
        dayLabel: WEEK_DAY_LABELS[day.weekDay],
        dateLabel: formatDate(day.date),
        closed: day.closed,
        restLabel: day.closed ? "Fermé" : onDay.length === 0 ? "Repos" : null,
        totalLabel: total > 0 ? durationLabel(total) : "",
        shifts: onDay,
      }
    }),
    rules: employee.rules,
    roster: employees.map((item) => ({
      employeeId: item.id,
      name: item.name,
      initials: initialsOf(item.name),
      selected: item.id === employee.id,
    })),
  }
}

// ── Summary ───────────────────────────────────────────────────

function buildSummary(
  input: PlanningBoardInput,
  days: readonly BoardDay[],
  employees: PlanningBoardInput["employees"],
  shifts: readonly BoardShift[],
  demand: PlanningBoardInput["demand"]
): BoardSummaryVM {
  // Deficits are recomputed from demand versus shifts, so the table always
  // matches the grid rather than echoing an engine message that may describe a
  // different period or sector.
  const deficits: BoardDeficitRowVM[] = []
  for (const slot of [...demand].sort(
    (left, right) => left.date.localeCompare(right.date) || left.startMinutes - right.startMinutes
  )) {
    const present = shifts.filter(
      (shift) =>
        shift.date === slot.date &&
        shift.segments.some(
          (segment) =>
            segment.startMinutes <= slot.startMinutes && segment.endMinutes >= slot.endMinutes
        )
    ).length
    if (present >= slot.requiredEmployees) continue
    const day = days.find((item) => item.date === slot.date)
    deficits.push({
      key: `${slot.date}_${slot.startMinutes}`,
      dayLabel: day ? `${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}` : slot.date,
      hourLabel: `${clockLabel(slot.startMinutes)} – ${clockLabel(slot.endMinutes)}`,
      required: slot.requiredEmployees,
      present,
    })
  }

  const offContract = employees.filter((employee) => {
    const planned = shifts
      .filter((shift) => shift.employeeId === employee.id)
      .reduce((sum, shift) => sum + shift.workedMinutes, 0)
    return planned !== employee.contractMinutes
  }).length

  const blocking = input.diagnostics?.blocking ?? false
  const requiresAcceptance = input.diagnostics?.requiresAcceptance ?? deficits.length > 0
  const status = blocking ? "blocked" : requiresAcceptance || deficits.length > 0 ? "reserves" : "ok"

  const facts: { label: string; level: BoardLevel }[] = []
  if (deficits.length > 0) {
    const plural = deficits.length > 1
    facts.push({
      label: `${deficits.length} créneau${plural ? "x" : ""} sous-couvert${plural ? "s" : ""}`,
      level: "under",
    })
  }
  if (offContract > 0) {
    const plural = offContract > 1
    facts.push({
      label: `${offContract} contrat${plural ? "s" : ""} non respecté${plural ? "s" : ""}`,
      level: "under",
    })
  }
  if (requiresAcceptance && !blocking) {
    facts.push({ label: "Acceptation requise avant publication", level: "over" })
  }
  if (facts.length === 0) {
    facts.push({ label: "Tous les besoins sont couverts", level: "ok" })
    facts.push({ label: "Tous les contrats sont respectés", level: "ok" })
  }

  return {
    status,
    title:
      status === "ok"
        ? "Planning conforme"
        : status === "reserves"
          ? "Planning publiable avec réserves"
          : "Planning non publiable",
    headline:
      status === "ok"
        ? "Aucun point de vigilance."
        : status === "reserves"
          ? "Vérifiez les points ci-dessous avant de publier."
          : "Des règles obligatoires ne sont pas respectées.",
    facts,
    deficits,
    technical: input.diagnostics?.technical ?? [],
  }
}

// ── Sector view ──────────────────────────────────────────────────────────────

function buildSectorView(
  employees: PlanningBoardInput["employees"],
  days: PlanningBoardInput["days"],
  shifts: readonly BoardShift[],
  shiftVMs: ReadonlyMap<string, BoardShiftVM>,
  selectedEmployeeId: EmployeeId | null
): BoardSectorViewVM {
  const columns: BoardSectorColumnVM[] = days.map((day) => ({
    date: day.date,
    label: `${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}`,
    shortLabel: WEEK_DAY_LABELS[day.weekDay].slice(0, 3),
    dateLabel: formatDate(day.date),
    closed: day.closed,
  }))

  const rows: BoardSectorRowVM[] = employees.map((employee) => {
    const own = shifts.filter((shift) => shift.employeeId === employee.id)
    const planned = own.reduce((sum, shift) => sum + shift.workedMinutes, 0)
    const difference = planned - employee.contractMinutes

    const shiftsByDate: Record<string, BoardShiftVM[]> = {}
    for (const shift of own) {
      const vm = shiftVMs.get(shift.id)
      if (!vm) continue
      ;(shiftsByDate[shift.date] ??= []).push(vm)
    }
    for (const list of Object.values(shiftsByDate)) {
      list.sort((left, right) => left.startLabel.localeCompare(right.startLabel))
    }

    return {
      employeeId: employee.id,
      name: employee.name,
      initials: initialsOf(employee.name),
      plannedLabel: durationLabel(planned),
      contractLabel: durationLabel(employee.contractMinutes),
      differenceLabel: signedDurationLabel(difference),
      hoursLabel: `${durationLabel(planned)} / ${durationLabel(employee.contractMinutes)}`,
      deviationLabel: difference === 0 ? null : signedDurationLabel(difference),
      onTarget: difference === 0,
      level: difference === 0 ? "ok" : difference > 0 ? "over" : "under",
      selected: employee.id === selectedEmployeeId,
      shiftsByDate,
    }
  })

  return { columns, rows }
}

// ── Day view ─────────────────────────────────────────────────────────────────

function buildDayView(
  employees: PlanningBoardInput["employees"],
  day: PlanningBoardInput["days"][number] | null,
  shifts: readonly BoardShift[],
  demand: PlanningBoardInput["demand"],
  open: number | null,
  span: number,
  selectedEmployeeId: EmployeeId | null
): BoardDayViewVM {
  if (!day || open === null || span <= 0) {
    return {
      date: day?.date ?? null,
      dateLabel: day ? `${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}` : "",
      closed: true,
      hours: [],
      requiredRow: [],
      presentRow: [],
      rows: [],
    }
  }

  // Whole hours from opening to closing. The width is expressed once, here, and
  // reused by the header and by every bar, which is what guarantees that a bar
  // starts exactly under its hour instead of merely looking like it does.
  const hourCount = Math.ceil(span / HOUR)
  const hourWidth = 100 / hourCount
  const hours: BoardHourVM[] = Array.from({ length: hourCount }, (_, index) => ({
    startMinutes: open + index * HOUR,
    label: clockLabel(open + index * HOUR),
    widthPercent: hourWidth,
  }))

  const onDay = shifts.filter((shift) => shift.date === day.date)

  const requiredRow: BoardCoverageCellVM[] = []
  const presentRow: BoardCoverageCellVM[] = []
  for (const hour of hours) {
    const hourEnd = hour.startMinutes + HOUR
    const required = demand
      .filter(
        (slot) =>
          slot.date === day.date && slot.startMinutes < hourEnd && slot.endMinutes > hour.startMinutes
      )
      .reduce((max, slot) => Math.max(max, slot.requiredEmployees), 0)
    const present = onDay.filter((shift) =>
      shift.segments.some(
        (segment) => segment.startMinutes <= hour.startMinutes && segment.endMinutes >= hourEnd
      )
    ).length

    requiredRow.push({
      startMinutes: hour.startMinutes,
      required,
      present,
      level: present >= required ? "ok" : "under",
    })
    presentRow.push({
      startMinutes: hour.startMinutes,
      required,
      present,
      level: present === required ? "ok" : present > required ? "over" : "under",
    })
  }

  const rows: BoardDayRowVM[] = employees.map((employee) => {
    const own = onDay
      .filter((shift) => shift.employeeId === employee.id)
      .map((shift) => toShiftVM(shift, open, span))
      .sort((left, right) => left.leftPercent - right.leftPercent)
    return {
      employeeId: employee.id,
      name: employee.name,
      initials: initialsOf(employee.name),
      selected: employee.id === selectedEmployeeId,
      restLabel: own.length === 0 ? "Repos" : null,
      shifts: own,
    }
  })

  return {
    date: day.date,
    dateLabel: `${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}`,
    closed: false,
    hours,
    requiredRow,
    presentRow,
    rows,
  }
}

// ── Formatting and geometry ──────────────────────────────────────────────────

function toShiftVM(shift: BoardShift, open: number | null, span: number): BoardShiftVM {
  const geometry = (start: number, end: number) =>
    open === null || span <= 0
      ? { leftPercent: 0, widthPercent: 0 }
      : {
          leftPercent: ((start - open) / span) * 100,
          widthPercent: ((end - start) / span) * 100,
        }

  return {
    id: shift.id,
    employeeId: shift.employeeId,
    date: shift.date,
    dateLabel: formatDate(shift.date),
    label: `${clockLabel(shift.startMinutes)} – ${clockLabel(shift.endMinutes)}`,
    startLabel: clockLabel(shift.startMinutes),
    endLabel: clockLabel(shift.endMinutes),
    durationLabel: durationLabel(shift.workedMinutes),
    isSplit: shift.segments.length > 1,
    opensDay: shift.opensDay,
    closesDay: shift.closesDay,
    kind: kindOf(shift),
    kindLabel: KIND_LABELS[kindOf(shift)],
    ...geometry(shift.startMinutes, shift.endMinutes),
    segments: shift.segments.map((segment) => geometry(segment.startMinutes, segment.endMinutes)),
  }
}

const KIND_LABELS: Record<BoardShiftKind, string> = {
  opening: "Ouverture",
  closing: "Fermeture",
  day: "Journée",
  split: "Coupure",
}

function kindOf(shift: BoardShift): BoardShiftKind {
  if (shift.segments.length > 1) return "split"
  if (shift.opensDay) return "opening"
  if (shift.closesDay) return "closing"
  return "day"
}

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
]

function longDate(date: IsoDate): string {
  const [, month, day] = date.split("-")
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`
}

export function clockLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(Math.abs(minutes) / 60)
  const rest = Math.abs(minutes) % 60
  return `${minutes < 0 ? "-" : ""}${hours}h${rest ? String(rest).padStart(2, "0") : ""}`
}

function signedDurationLabel(minutes: number): string {
  if (minutes === 0) return "0h"
  return `${minutes > 0 ? "+" : ""}${durationLabel(minutes)}`
}

function formatDate(date: IsoDate): string {
  const [, month, day] = date.split("-")
  return `${day}/${month}`
}

function weekLabel(start: IsoDate, end: IsoDate): string {
  return `Semaine du ${formatDate(start)} au ${formatDate(end)}`
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}
