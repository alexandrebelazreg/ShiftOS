import type {
  Assignment,
  EmployeeId,
  IsoDate,
  Shift,
  WeekDay,
} from "@/features/core/models"
import { contractualMinutes } from "@/features/core/models"
import { enumerateDates, intervalMinutes, weekDayOf } from "@/features/core/shared"
import { earliestStart, isSplitShift, latestEnd } from "@/features/core/statistics-engine"

import type { EditorState } from "@/features/planning/editor/editor-state"
import type { EditorEvaluation } from "@/features/planning/editor/editor-evaluation"
import type { WarningLevel } from "@/features/planning/editor/warning-levels"
import { dayCoverageLevel, employeeLevel } from "@/features/planning/editor/warning-levels"

// ── Sector view ──────────────────────────────────────────────────────────────

export interface DayCoverage {
  readonly date: IsoDate
  readonly weekDay: WeekDay
  readonly coverageRate: number
  readonly level: WarningLevel
}

export interface CellShift {
  readonly shiftId: string
  readonly assignmentId: string
  readonly start: string
  readonly end: string
  readonly hours: number
  readonly isSplit: boolean
}

export interface SectorRow {
  readonly employeeId: EmployeeId
  readonly name: string
  readonly plannedHours: number
  readonly contractHours: number
  readonly level: WarningLevel
  readonly cellsByDate: Readonly<Record<string, CellShift[]>>
}

export interface SectorGrid {
  readonly days: readonly DayCoverage[]
  readonly rows: readonly SectorRow[]
}

// ── Employee view ────────────────────────────────────────────────────────────

export interface EmployeeShift {
  readonly date: IsoDate
  readonly weekDay: WeekDay
  readonly shiftId: string
  readonly assignmentId: string
  readonly start: string
  readonly end: string
  readonly hours: number
  readonly isSplit: boolean
}

export interface EmployeeSummary {
  readonly employeeId: EmployeeId
  readonly name: string
  readonly contractHours: number
  readonly plannedHours: number
  readonly differenceHours: number
  readonly openingCount: number
  readonly closingCount: number
  readonly saturdayCount: number
  readonly level: WarningLevel
  readonly warnings: readonly string[]
  readonly shifts: readonly EmployeeShift[]
}

/** Compact `{ id, name }` list for the employee selector. */
export function listEmployees(state: EditorState): { id: EmployeeId; name: string }[] {
  return state.coreInput.employees.map((e) => ({
    id: e.id,
    name: `${e.firstName} ${e.lastName}`.trim(),
  }))
}

/**
 * Build the Sector grid (employees × days) with per-day coverage headers and
 * per-employee planned/contract totals. Derived entirely from the single state
 * and its live evaluation.
 */
export function buildSectorGrid(state: EditorState, evaluation: EditorEvaluation): SectorGrid {
  const dates = enumerateDates(state.planning.periodStart, state.planning.periodEnd)
  const coverageByDate = coverageRateByDate(evaluation)

  const days: DayCoverage[] = dates.map((date) => {
    const rate = coverageByDate.get(date) ?? 1
    return { date, weekDay: weekDayOf(date), coverageRate: rate, level: dayCoverageLevel(rate) }
  })

  const shiftById = new Map<Shift["id"], Shift>(state.shifts.map((s) => [s.id, s]))
  const statsByEmployee = new Map(evaluation.statistics.employees.map((s) => [s.employeeId, s]))
  const contractHoursByEmployee = new Map(
    state.coreInput.contracts.map((c) => [c.employeeId, contractualMinutes(c) / 60])
  )
  const cellsByEmployee = groupCells(state.assignments, shiftById)

  const rows: SectorRow[] = state.coreInput.employees.map((employee) => {
    const plannedMinutes = statsByEmployee.get(employee.id)?.workedMinutes ?? 0
    const contractHours = contractHoursByEmployee.get(employee.id) ?? 0
    return {
      employeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
      plannedHours: plannedMinutes / 60,
      contractHours,
      level: employeeLevel(
        plannedMinutes,
        contractHours * 60,
        evaluation.employeesWithHardViolation.has(employee.id)
      ),
      cellsByDate: cellsByEmployee.get(employee.id) ?? {},
    }
  })

  return { days, rows }
}

/** Build the summary for one employee, or `null` when the id is unknown. */
export function buildEmployeeSummary(
  state: EditorState,
  evaluation: EditorEvaluation,
  employeeId: EmployeeId
): EmployeeSummary | null {
  const employee = state.coreInput.employees.find((e) => e.id === employeeId)
  if (!employee) return null

  const stat = evaluation.statistics.employees.find((s) => s.employeeId === employeeId)
  const contract = state.coreInput.contracts.find((c) => c.employeeId === employeeId)
  const contractHours = contract ? contractualMinutes(contract) / 60 : 0
  const plannedMinutes = stat?.workedMinutes ?? 0
  const plannedHours = plannedMinutes / 60

  const shiftById = new Map<Shift["id"], Shift>(state.shifts.map((s) => [s.id, s]))
  const shifts: EmployeeShift[] = state.assignments
    .filter((a) => a.employeeId === employeeId)
    .map((a) => ({ assignment: a, shift: shiftById.get(a.shiftId) }))
    .filter((entry): entry is { assignment: Assignment; shift: Shift } => entry.shift !== undefined)
    .map(({ assignment, shift }) => ({
      date: shift.date,
      weekDay: weekDayOf(shift.date),
      shiftId: shift.id,
      assignmentId: assignment.id,
      start: earliestStart(shift),
      end: latestEnd(shift),
      hours: shiftMinutes(shift) / 60,
      isSplit: isSplitShift(shift),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  return {
    employeeId,
    name: `${employee.firstName} ${employee.lastName}`.trim(),
    contractHours,
    plannedHours,
    differenceHours: plannedHours - contractHours,
    openingCount: stat?.openingCount ?? 0,
    closingCount: stat?.closingCount ?? 0,
    saturdayCount: stat?.saturdayCount ?? 0,
    level: employeeLevel(
      plannedMinutes,
      contractHours * 60,
      evaluation.employeesWithHardViolation.has(employeeId)
    ),
    warnings: employeeWarnings(state, evaluation, employeeId, plannedHours, contractHours),
    shifts,
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function coverageRateByDate(evaluation: EditorEvaluation): Map<string, number> {
  const total = new Map<string, number>()
  const covered = new Map<string, number>()
  for (const result of evaluation.coverage.results) {
    const date = result.window.date
    total.set(date, (total.get(date) ?? 0) + 1)
    if (result.status === "covered" || result.status === "over_covered") {
      covered.set(date, (covered.get(date) ?? 0) + 1)
    }
  }
  const rate = new Map<string, number>()
  for (const [date, count] of total) rate.set(date, count > 0 ? (covered.get(date) ?? 0) / count : 1)
  return rate
}

function groupCells(
  assignments: readonly Assignment[],
  shiftById: ReadonlyMap<Shift["id"], Shift>
): Map<EmployeeId, Record<string, CellShift[]>> {
  const byEmployee = new Map<EmployeeId, Record<string, CellShift[]>>()
  for (const assignment of assignments) {
    const shift = shiftById.get(assignment.shiftId)
    if (!shift) continue
    const cells = byEmployee.get(assignment.employeeId) ?? {}
    const list = cells[shift.date] ?? []
    list.push({
      shiftId: shift.id,
      assignmentId: assignment.id,
      start: earliestStart(shift),
      end: latestEnd(shift),
      hours: shiftMinutes(shift) / 60,
      isSplit: isSplitShift(shift),
    })
    cells[shift.date] = list
    byEmployee.set(assignment.employeeId, cells)
  }
  return byEmployee
}

function employeeWarnings(
  state: EditorState,
  evaluation: EditorEvaluation,
  employeeId: EmployeeId,
  plannedHours: number,
  contractHours: number
): string[] {
  const messages: string[] = []
  const violations = [
    ...evaluation.constraintReport.hardViolations,
    ...evaluation.constraintReport.softViolations,
  ]
  for (const violation of violations) {
    if (violation.affected?.some((ref) => ref.type === "employee" && ref.id === employeeId)) {
      messages.push(violation.message)
    }
  }
  if (contractHours > 0 && plannedHours > contractHours) {
    messages.push(
      `Contract exceeded by ${Math.round((plannedHours - contractHours) * 100) / 100}h`
    )
  }
  return messages
}

function shiftMinutes(shift: Shift): number {
  return shift.segments.reduce(
    (sum, s) => sum + (intervalMinutes(s.startTime, s.endTime, s.endDayOffset) ?? 0),
    0
  )
}
