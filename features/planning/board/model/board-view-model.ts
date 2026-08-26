import type { EmployeeId, IsoDate } from "@/features/core/models"
import { minimumConcurrentPresence } from "@/features/core/shared"

import type {
  BoardDay,
  BoardHoliday,
  BoardShift,
  PlanningBoardInput,
  PlanningBoardSelection,
} from "@/features/planning/board/model/board-input"
import {
  clockLabel,
  durationLabel,
  formatDate,
  initialsOf,
  longDate,
  signedDurationLabel,
  weekLabel,
  WEEK_DAY_LABELS,
} from "@/features/planning/board/model/labels"
import { isoWeekNumber } from "@/features/planning/board/model/week"
import { holidayProfileOf } from "@/features/planning/holidays/model/employee-holiday-profile"
import {
  describeDayCodes,
  holidayTreatment,
} from "@/features/planning/holidays/model/holiday-treatment"

// Les libellés vivent désormais dans `labels.ts`, partagés avec la feuille
// d'affichage. Réexportés ici parce que c'est de ce module que le reste du board
// les importe depuis toujours : déplacer un fichier n'est pas changer une API.
export { clockLabel, durationLabel } from "@/features/planning/board/model/labels"

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
  /**
   * One block per CONTINUOUS segment — deux rayons enchaînés sans interruption
   * font un seul segment, comme sur la fiche du salarié.
   *
   * Chaque segment porte les rayons qu'il traverse, positionnés en pourcentage
   * DE LUI-MÊME. C'est ce qui permet de peindre les rayons à l'intérieur d'une
   * barre déplaçable : la barre suit les minutes, les rayons suivent la barre.
   */
  readonly segments: readonly {
    readonly leftPercent: number
    readonly widthPercent: number
    readonly sectors: readonly (BoardSectorBlockVM & {
      readonly offsetPercent: number
    })[]
  }[]
  readonly sectorBlocks: readonly BoardSectorBlockVM[]
}

export interface BoardSectorBlockVM {
  readonly sectorId: string
  readonly sectorName: string
  /** La couleur du rayon, ou `null` s'il n'en déclare pas. */
  readonly color: string | null
  /** Ce bloc ouvre-t-il SON comptoir ? Rendu comme un ombrage à gauche. */
  readonly opens: boolean
  /** Le ferme-t-il ? Ombrage à droite. */
  readonly closes: boolean
  readonly startLabel: string
  readonly endLabel: string
  readonly durationLabel: string
  /**
   * Les minutes brutes du bloc, en plus de leurs libellés.
   *
   * Une feuille d'affichage additionne et ordonne des blocs — le total d'un
   * comptoir sur la journée, les postes rangés par heure de prise. Le faire en
   * relisant « 06:00 » serait reparser ce que ce ViewModel vient d'écrire.
   */
  readonly startMinutes: number
  readonly endMinutes: number
  readonly leftPercent: number
  readonly widthPercent: number
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
  readonly sectors: readonly { readonly id: string; readonly name: string; readonly selected: boolean; readonly marketZone?: boolean }[]
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
  /** Le nom du férié, quand ce jour en est un. « Fête Nationale ». */
  readonly holidayName: string | null
  /**
   * Everyone's hours on this day, added up.
   *
   * The one figure that says whether a day is over- or under-loaded relative to
   * its neighbours — a question the per-employee rows cannot answer, because
   * each of them is individually reasonable while the week leans on Friday.
   * Null on a closed day: no hours is not "0 h worked", it is no day at all.
   */
  readonly totalLabel: string | null
}

export interface BoardSectorRowVM {
  readonly employeeId: EmployeeId
  readonly name: string
  readonly initials: string
  readonly plannedLabel: string
  readonly contractLabel: string
  readonly differenceLabel: string
  /** One explicit line separating planned, sector target and employment contract. */
  readonly hoursLabel: string
  readonly targetKind: "contract" | "sector-allocation" | "filtered-selection"
  /** False when only part of a multi-sector contract is visible. */
  readonly comparisonAvailable: boolean
  /** Only set when the contract is actually missed, so it can stay hidden. */
  readonly deviationLabel: string | null
  /** True when planned equals contracted: the grid shows a tick instead. */
  readonly onTarget: boolean
  readonly level: BoardLevel
  readonly selected: boolean
  /** Shifts per date, aligned with `columns`. */
  readonly shiftsByDate: Readonly<Record<string, readonly BoardShiftVM[]>>
  /**
   * Ce que dit un jour férié pour CE salarié, en toutes lettres.
   *
   * « Férié non travaillé », « Jour férié », « Repos »… jamais un sigle : ces
   * cases se lisent par-dessus l'épaule de quelqu'un, et « HF » ne veut rien
   * dire pour la personne concernée.
   */
  readonly holidayLabelByDate: Readonly<Record<string, string>>
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
  /** Le traitement du férié, en toutes lettres, même quand la personne travaille. */
  readonly holidayLabel: string | null
  readonly shifts: readonly BoardShiftVM[]
}

export interface BoardDayViewVM {
  readonly date: IsoDate | null
  readonly dateLabel: string
  readonly closed: boolean
  /**
   * L'amplitude réellement ouverte ce jour-là — « 06:00 – 20:30 ».
   *
   * Celle des rayons SÉLECTIONNÉS, pas celle du magasin : c'est la fenêtre sur
   * laquelle la grille est dessinée. Les heures ci-dessous sont arrondies à
   * l'heure pleine pour servir de règle, donc elles ne peuvent pas la dire.
   */
  readonly windowLabel: string | null
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

const HOUR = 60

/**
 * Ce qu'un jour férié dit d'un salarié, en toutes lettres.
 *
 * Calculé ICI, une seule fois, pour les trois vues — sinon la grille de la
 * semaine, la journée et la fiche du salarié pourraient décrire la même
 * journée de trois façons différentes.
 *
 * La PRÉSENCE est déduite du planning : quelqu'un qui a des plages ce jour-là
 * travaille, les autres non. C'est la seule lecture possible ici, et c'est la
 * bonne — le férié se lit APRÈS que le moteur a tranché.
 */
function holidayLabelsFor(
  input: PlanningBoardInput,
  shifts: readonly BoardShift[]
): Map<string, string> {
  const labels = new Map<string, string>()
  const holidays = input.holidays ?? []
  if (holidays.length === 0) return labels

  for (const holiday of holidays) {
    const day = input.days.find((entry) => entry.date === holiday.date)
    if (!day) continue
    for (const employee of input.employees) {
      const worked = shifts.some(
        (shift) => shift.date === holiday.date && shift.employeeId === employee.id
      )
      const profile = holidayProfileOf(employee)
      const label = describeDayCodes(
        holidayTreatment({
          opening: holiday.opening,
          scheduleType: profile.scheduleType,
          forfaitJour: profile.forfaitJour,
          sunday: day.weekDay === "sunday",
          storeOpensSundays: input.storeOpensSundays ?? false,
          usuallyWorksSundays: !(employee.fixedRestDays ?? []).includes("sunday"),
          usualRestDay: (employee.fixedRestDays ?? []).includes(day.weekDay),
          presence: worked ? "full" : "none",
        }).codes
      )
      if (label) labels.set(`${employee.id}_${holiday.date}`, label)
    }
  }
  return labels
}

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
  // The selected sectors as a set. Empty shows nothing; every id shows the
  // union — the multiselect states its choice explicitly, no "null means all".
  const selectedSectors = new Set(selection.sectorIds)
  const inSelection = (sectorId: string) => selectedSectors.has(sectorId)
  const days = daysForSelection(input, selectedSectors)
    .sort((left, right) => left.date.localeCompare(right.date))
  const openDays = days.filter((day) => !day.closed)
  const date = selection.date ?? openDays[0]?.date ?? days[0]?.date ?? null

  // ONE filtered set. Both views read it; neither re-filters.
  const shifts = input.shifts.flatMap((shift) => {
    // Ouvrir et fermer sont des faits DU BLOC, pas du shift : dans une zone
    // marché la même personne peut ouvrir un comptoir sans toucher l'autre.
    const sectorAssignments = sectorAssignmentsOf(shift)
      .filter((block) => inSelection(block.sectorId))
      .map((block) => ({
        ...block,
        opens: sectorBoundary(input, shift.date, block.sectorId, "open") === block.startMinutes,
        closes: sectorBoundary(input, shift.date, block.sectorId, "close") === block.endMinutes,
      }))
    if (sectorAssignments.length === 0) return []
    const workedMinutes = sectorAssignments.reduce(
      (sum, block) => sum + block.endMinutes - block.startMinutes,
      0
    )
    const startMinutes = Math.min(...sectorAssignments.map((block) => block.startMinutes))
    const endMinutes = Math.max(...sectorAssignments.map((block) => block.endMinutes))
    return [{
      ...shift,
      sectorAssignments,
      // Les blocs CONTIGUS se recollent. Un segment est une plage travaillée
      // sans interruption : changer de rayon à midi n'est pas une coupure, et
      // le compter comme telle affichait « journée coupée » sur une journée qui
      // ne l'est pas, et surtout désalignait la barre éditable — celle-ci suit
      // les segments RÉELS du shift, donc une barre unique se peignait avec le
      // seul premier rayon.
      segments: mergeContiguous(sectorAssignments),
      startMinutes,
      endMinutes,
      workedMinutes,
      opensDay: sectorAssignments.some((block) => block.opens),
      closesDay: sectorAssignments.some((block) => block.closes),
    }]
  })
  const employees = input.employees.filter((employee) =>
    employee.sectorIds.some(inSelection)
  )
  const demand = input.demand.filter((slot) => inSelection(slot.sectorId))

  const day = days.find((item) => item.date === date) ?? null
  const open = day?.opensAtMinutes ?? null
  const close = day?.closesAtMinutes ?? null
  const span = open !== null && close !== null && close > open ? close - open : 0

  const shiftVMs = new Map<string, BoardShiftVM>()
  for (const shift of shifts) {
    shiftVMs.set(shift.id, toShiftVM(shift, shift.date === date ? open : null, shift.date === date ? span : 0, input.sectors))
  }

  const completeSectorSelection = input.sectors.every((sector) => selectedSectors.has(sector.id))
  // Une seule lecture des fériés, partagée par les trois vues.
  const holidayLabels = holidayLabelsFor(input, shifts)

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
        selected: inSelection(sector.id),
        marketZone: sector.marketZone,
      })),
      days: days.map((item) => ({
        date: item.date,
        label: `${WEEK_DAY_LABELS[item.weekDay]} ${formatDate(item.date)}`,
        shortLabel: WEEK_DAY_LABELS[item.weekDay].slice(0, 3),
        closed: item.closed,
        selected: item.date === date,
      })),
    },
    sectorView: buildSectorView(
      employees,
      days,
      shifts,
      shiftVMs,
      selection.employeeId,
      completeSectorSelection,
      input.holidays ?? [],
      holidayLabels
    ),
    dayView: buildDayView(employees, day, shifts, demand, open, span, selection.employeeId, input.sectors, holidayLabels),
    employeeView: buildEmployeeView(
      employees,
      days,
      shifts,
      selection.employeeId,
      completeSectorSelection,
      input.sectors,
      holidayLabels
    ),
    summary: buildSummary(input, days, employees, shifts, demand, completeSectorSelection),
  }
}

// ── Employee view ──────────────────────────────────────────────

function buildEmployeeView(
  employees: PlanningBoardInput["employees"],
  days: readonly BoardDay[],
  shifts: readonly BoardShift[],
  employeeId: EmployeeId | null,
  completeSectorSelection: boolean,
  sectors: PlanningBoardInput["sectors"] = [],
  holidayLabels: ReadonlyMap<string, string> = new Map()
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
  const target = employee.weeklyTargetMinutes ?? employee.contractMinutes
  const difference = planned - target
  const comparisonAvailable = completeSectorSelection || employee.weeklyTargetMinutes !== undefined
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
      ...(employee.weeklyTargetMinutes !== undefined
        ? [{
            label: "Objectif de cette génération",
            value: durationLabel(employee.weeklyTargetMinutes),
            level: "neutral" as const,
          }]
        : []),
      { label: "Heures planifiées", value: durationLabel(planned), level: "neutral" },
      ...(comparisonAvailable ? [{
        label: employee.weeklyTargetMinutes === undefined ? "Écart" : "Écart à l’objectif",
        value: signedDurationLabel(difference),
        level: difference === 0 ? "ok" as const : difference > 0 ? "over" as const : "under" as const,
      }] : []),
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
        .map((shift) => toShiftVM(shift, open, span, sectors))
        .sort((left, right) => left.leftPercent - right.leftPercent)
      const total = own
        .filter((shift) => shift.date === day.date)
        .reduce((sum, shift) => sum + shift.workedMinutes, 0)
      return {
        date: day.date,
        dayLabel: WEEK_DAY_LABELS[day.weekDay],
        dateLabel: formatDate(day.date),
        closed: day.closed,
        // Le férié prime sur « Repos » : il dit pourquoi la journée est vide.
        restLabel: day.closed
          ? "Fermé"
          : onDay.length === 0
            ? holidayLabels.get(`${employee.id}_${day.date}`) ?? "Repos"
            : null,
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
  demand: PlanningBoardInput["demand"],
  completeSectorSelection: boolean
): BoardSummaryVM {
  // Deficits are recomputed from demand versus shifts, so the table always
  // matches the grid rather than echoing an engine message that may describe a
  // different period or sector.
  //
  // Presence is a CONCURRENCY question, not a per-shift containment one. This
  // used to count only the shifts that spanned the whole slot on their own,
  // which reported an hour as short whenever it was covered by a hand-over: one
  // person until 12:15, another from 12:15, both present throughout, and the
  // table announced a single body on the floor. The « Présents » row above it
  // has always counted concurrency, so the two disagreed on the same screen —
  // and the row was the one telling the truth.
  const deficits: BoardDeficitRowVM[] = []
  for (const slot of [...demand].sort(
    (left, right) => left.date.localeCompare(right.date) || left.startMinutes - right.startMinutes
  )) {
    const present = minimumConcurrentPresence(
      { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes },
      shifts
        .filter((shift) => shift.date === slot.date)
        .flatMap((shift) => sectorAssignmentsOf(shift)
          .filter((block) => block.sectorId === slot.sectorId)
          .map((segment) => ({
          startMinutes: segment.startMinutes,
          endMinutes: segment.endMinutes,
        })))
    )
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

  const offContract = completeSectorSelection ? employees.filter((employee) => {
    if (employee.weeklyTargetMinutes !== undefined) return false
    const planned = shifts
      .filter((shift) => shift.employeeId === employee.id)
      .reduce((sum, shift) => sum + shift.workedMinutes, 0)
    return planned !== employee.contractMinutes
  }).length : 0
  const scopedEmployees = employees.filter((employee) => employee.weeklyTargetMinutes !== undefined)
  const offScopeTarget = scopedEmployees.filter((employee) => {
    const planned = shifts
      .filter((shift) => shift.employeeId === employee.id)
      .reduce((sum, shift) => sum + shift.workedMinutes, 0)
    return planned !== employee.weeklyTargetMinutes
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
  if (offScopeTarget > 0) {
    const plural = offScopeTarget > 1
    facts.push({
      label: `${offScopeTarget} objectif${plural ? "s" : ""} de rayon non atteint${plural ? "s" : ""}`,
      level: "under",
    })
  }
  if (requiresAcceptance && !blocking) {
    facts.push({ label: "Acceptation requise avant publication", level: "over" })
  }
  if (facts.length === 0) {
    facts.push({ label: "Tous les besoins sont couverts", level: "ok" })
    facts.push({
      label:
        scopedEmployees.length > 0
          ? "Toutes les affectations prévues dans ce rayon sont réalisées"
          : !completeSectorSelection
          ? "Les contrats complets sont contrôlés dans la vue de tous les secteurs"
          : "Tous les contrats sont respectés",
      level: "ok",
    })
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
  selectedEmployeeId: EmployeeId | null,
  completeSectorSelection: boolean,
  holidays: readonly BoardHoliday[] = [],
  holidayLabels: ReadonlyMap<string, string> = new Map()
): BoardSectorViewVM {
  const holidayNames = new Map(holidays.map((holiday) => [holiday.date, holiday.name]))
  const columns: BoardSectorColumnVM[] = days.map((day) => ({
    date: day.date,
    label: `${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}`,
    shortLabel: WEEK_DAY_LABELS[day.weekDay].slice(0, 3),
    dateLabel: formatDate(day.date),
    closed: day.closed,
    holidayName: holidayNames.get(day.date) ?? null,
    totalLabel: day.closed
      ? null
      : durationLabel(
          shifts
            .filter((shift) => shift.date === day.date)
            .reduce((sum, shift) => sum + shift.workedMinutes, 0)
        ),
  }))

  const rows: BoardSectorRowVM[] = employees.map((employee) => {
    const own = shifts.filter((shift) => shift.employeeId === employee.id)
    const planned = own.reduce((sum, shift) => sum + shift.workedMinutes, 0)
    const comparisonAvailable = completeSectorSelection || employee.weeklyTargetMinutes !== undefined
    const target = employee.weeklyTargetMinutes ?? employee.contractMinutes
    const difference = planned - target

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
      differenceLabel: comparisonAvailable ? signedDurationLabel(difference) : "—",
      /**
       * « fait / dû », et le mot en plus seulement quand il change le sens.
       *
       * Les phrases d'avant — « 36h45 planifiées · contrat 36h45 » — disaient
       * trois fois la même chose dans une ligne lue en diagonale, sous chacun
       * des vingt noms. Deux nombres séparés d'une barre se comparent d'un
       * regard, et c'est tout ce qu'on demande à cette ligne.
       *
       * LE DÉNOMINATEUR EST LA CIBLE, pas le contrat. C'est lui que l'écart
       * juste à côté mesure ; afficher le contrat pendant qu'on compare à la
       * part de rayon produirait deux nombres égaux surmontés d'un écart.
       *
       * D'où le suffixe. Sans lui, une part de rayon atteinte ressemble trait
       * pour trait à un contrat rempli, et le gérant croirait la semaine faite
       * alors qu'il reste les autres rayons. « sélection partielle » dit
       * l'autre cas : on ne voit qu'un morceau de ses rayons, donc les heures
       * affichées ne se comparent à rien — et aucun écart ne s'affiche.
       */
      hoursLabel:
        !comparisonAvailable
          ? `${durationLabel(planned)} / ${durationLabel(employee.contractMinutes)} · sélection partielle`
          : employee.weeklyTargetMinutes === undefined
          ? `${durationLabel(planned)} / ${durationLabel(target)}`
          : `${durationLabel(planned)} / ${durationLabel(target)} · rayon`,
      targetKind:
        !comparisonAvailable
          ? "filtered-selection"
          : employee.weeklyTargetMinutes === undefined ? "contract" : "sector-allocation",
      comparisonAvailable,
      deviationLabel: !comparisonAvailable || difference === 0 ? null : signedDurationLabel(difference),
      onTarget: comparisonAvailable && difference === 0,
      level: !comparisonAvailable ? "neutral" : difference === 0 ? "ok" : difference > 0 ? "over" : "under",
      selected: employee.id === selectedEmployeeId,
      shiftsByDate,
      holidayLabelByDate: Object.fromEntries(
        [...holidayNames.keys()].flatMap((date) => {
          const label = holidayLabels.get(`${employee.id}_${date}`)
          return label ? [[date, label] as const] : []
        })
      ),
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
  selectedEmployeeId: EmployeeId | null,
  sectors: PlanningBoardInput["sectors"] = [],
  holidayLabels: ReadonlyMap<string, string> = new Map()
): BoardDayViewVM {
  if (!day || open === null || span <= 0) {
    return {
      date: day?.date ?? null,
      dateLabel: day ? `${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}` : "",
      closed: true,
      windowLabel: null,
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
    const requiredBySector = demand
      .filter(
        (slot) =>
          slot.date === day.date && slot.startMinutes < hourEnd && slot.endMinutes > hour.startMinutes
      )
      .reduce((bySector, slot) => {
        bySector.set(
          slot.sectorId,
          Math.max(bySector.get(slot.sectorId) ?? 0, slot.requiredEmployees)
        )
        return bySector
      }, new Map<string, number>())
    const required = [...requiredBySector.values()].reduce((sum, value) => sum + value, 0)
    // The worst concurrent headcount inside the hour, not the count of shifts
    // that each individually span it. Two or three staggered shifts routinely
    // keep the floor staffed throughout an hour without any of them
    // individually covering it — the old "full-hour-span" check reported the
    // hour thin exactly when it wasn't.
    const present = minimumConcurrentPresence(
      { startMinutes: hour.startMinutes, endMinutes: hourEnd },
      onDay.flatMap((shift) => sectorAssignmentsOf(shift))
    )

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
      .map((shift) => toShiftVM(shift, open, span, sectors))
      .sort((left, right) => left.leftPercent - right.leftPercent)
    // Un férié dit POURQUOI la journée est vide ; « Repos » ne le dit pas.
    const holiday = holidayLabels.get(`${employee.id}_${day.date}`) ?? null
    return {
      employeeId: employee.id,
      name: employee.name,
      initials: initialsOf(employee.name),
      selected: employee.id === selectedEmployeeId,
      restLabel: own.length === 0 ? holiday ?? "Repos" : null,
      holidayLabel: holiday,
      shifts: own,
    }
  })

  return {
    date: day.date,
    dateLabel: `${WEEK_DAY_LABELS[day.weekDay]} ${formatDate(day.date)}`,
    closed: false,
    windowLabel: `${clockLabel(open)} – ${clockLabel(open + span)}`,
    hours,
    requiredRow,
    presentRow,
    rows,
  }
}

// ── Formatting and geometry ──────────────────────────────────────────────────

function toShiftVM(
  shift: BoardShift,
  open: number | null,
  span: number,
  sectors: PlanningBoardInput["sectors"] = []
): BoardShiftVM {
  const geometry = (start: number, end: number) =>
    open === null || span <= 0
      ? { leftPercent: 0, widthPercent: 0 }
      : {
          leftPercent: ((start - open) / span) * 100,
          widthPercent: ((end - start) / span) * 100,
        }

  const blocks = sectorAssignmentsOf(shift)
  const describe = (block: (typeof blocks)[number]): BoardSectorBlockVM => ({
    sectorId: block.sectorId,
    sectorName: sectors.find((sector) => sector.id === block.sectorId)?.name ?? block.sectorId,
    color: sectors.find((sector) => sector.id === block.sectorId)?.color ?? null,
    opens: "opens" in block ? Boolean(block.opens) : false,
    closes: "closes" in block ? Boolean(block.closes) : false,
    startLabel: clockLabel(block.startMinutes),
    endLabel: clockLabel(block.endMinutes),
    durationLabel: durationLabel(block.endMinutes - block.startMinutes),
    startMinutes: block.startMinutes,
    endMinutes: block.endMinutes,
    ...geometry(block.startMinutes, block.endMinutes),
  })

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
    segments: shift.segments.map((segment) => {
      const span = segment.endMinutes - segment.startMinutes
      return {
        ...geometry(segment.startMinutes, segment.endMinutes),
        sectors: blocks
          .filter(
            (block) =>
              block.startMinutes < segment.endMinutes
              && block.endMinutes > segment.startMinutes
          )
          .map((block) => {
            const start = Math.max(block.startMinutes, segment.startMinutes)
            const end = Math.min(block.endMinutes, segment.endMinutes)
            return {
              ...describe(block),
              offsetPercent: span > 0 ? ((start - segment.startMinutes) / span) * 100 : 0,
              widthPercent: span > 0 ? ((end - start) / span) * 100 : 0,
            }
          }),
      }
    }),
    sectorBlocks: blocks.map(describe),
  }
}

function sectorAssignmentsOf(shift: BoardShift): readonly (BoardShift["segments"][number] & { readonly sectorId: string })[] {
  return shift.sectorAssignments ?? shift.segments.map((segment) => ({ ...segment, sectorId: shift.sectorId }))
}

/** Les plages travaillées sans interruption, rayons confondus. */
function mergeContiguous(
  blocks: readonly { readonly startMinutes: number; readonly endMinutes: number }[]
): { readonly startMinutes: number; readonly endMinutes: number }[] {
  const ordered = [...blocks].sort((left, right) => left.startMinutes - right.startMinutes)
  const merged: { startMinutes: number; endMinutes: number }[] = []
  for (const block of ordered) {
    const last = merged[merged.length - 1]
    if (last && block.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, block.endMinutes)
      continue
    }
    merged.push({ startMinutes: block.startMinutes, endMinutes: block.endMinutes })
  }
  return merged
}

/** Rebuild the visible day window from the sectors currently selected. */
function daysForSelection(
  input: PlanningBoardInput,
  selectedSectors: ReadonlySet<string>
): BoardDay[] {
  const sectors = input.sectors.filter((sector) => selectedSectors.has(sector.id))
  return input.days.map((fallback) => {
    if (sectors.length === 0) {
      return { ...fallback, closed: true, opensAtMinutes: null, closesAtMinutes: null }
    }
    const candidates = sectors.map((sector) => {
      const hours = sector.hours?.find((entry) => entry.day === fallback.weekDay)
      if (!hours) return fallback.closed ? null : fallback
      if (hours.closed || !hours.opensAt || !hours.closesAt) return null
      return {
        opensAtMinutes: parseClock(hours.opensAt),
        closesAtMinutes: parseClock(hours.closesAt),
      }
    }).filter((hours): hours is { opensAtMinutes: number; closesAtMinutes: number } =>
      hours !== null && hours.opensAtMinutes !== null && hours.closesAtMinutes !== null
    )
    if (candidates.length === 0) {
      return { ...fallback, closed: true, opensAtMinutes: null, closesAtMinutes: null }
    }
    return {
      ...fallback,
      closed: false,
      opensAtMinutes: Math.min(...candidates.map((hours) => hours.opensAtMinutes)),
      closesAtMinutes: Math.max(...candidates.map((hours) => hours.closesAtMinutes)),
    }
  })
}

function sectorBoundary(
  input: PlanningBoardInput,
  date: IsoDate,
  sectorId: string,
  side: "open" | "close"
): number | null {
  const day = input.days.find((entry) => entry.date === date)
  if (!day) return null
  const hours = input.sectors
    .find((sector) => sector.id === sectorId)
    ?.hours?.find((entry) => entry.day === day.weekDay)
  if (!hours) return side === "open" ? day.opensAtMinutes : day.closesAtMinutes
  if (hours.closed) return null
  return parseClock(side === "open" ? hours.opensAt : hours.closesAt)
}

function parseClock(value: string): number | null {
  const [hour, minute] = value.split(":").map(Number)
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null
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

