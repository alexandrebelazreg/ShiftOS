import type { EmployeeId } from "@/features/core/models"
import { minimumConcurrentPresence } from "@/features/core/shared"

import type { PlanningBoardInput } from "@/features/planning/board/model/board-input"
import { clockLabel } from "@/features/planning/board/model/board-view-model"

/**
 * How a locally edited week differs from the one the engine generated.
 *
 * Two readings, both pure, both measured against the ORIGINAL generated
 * schedule so that "Réinitialiser" always brings every figure back to zero:
 *
 *   - a per-employee **badge** — did this person's day gain time, lose time, or
 *     just move (`+15 min`, `-30 min`, `Décalé +30 min`);
 *   - a day-level **verdict** — the one business sentence a manager acts on,
 *     chosen by a strict priority so a coverage win can never hide a broken
 *     contract or an impossible schedule.
 *
 * The verdict is deliberately weekly where it must be: a contract is a weekly
 * quantity, so moving fifteen minutes from Monday to Tuesday leaves it intact,
 * whereas extending a shift breaks it — and the verdict says so regardless of
 * which day is on screen.
 */

// ── Badges ───────────────────────────────────────────────────────────────────

/** What kind of change a badge reports. Drives its colour, nothing else. */
export type ShiftDeltaKind = "unchanged" | "extended" | "reduced" | "shifted"

export interface ShiftDeltaVM {
  readonly kind: ShiftDeltaKind
  /** "+15 min", "-30 min", "Décalé +30 min", "± 0". */
  readonly label: string
}

const HOUR = 60

/** "+30 min", "+1 h", "-1 h 30", "± 0" — the signed magnitude of a change. */
export function deltaLabel(deltaMinutes: number): string {
  if (deltaMinutes === 0) return "± 0"
  const sign = deltaMinutes > 0 ? "+" : "-"
  const abs = Math.abs(deltaMinutes)
  const hours = Math.floor(abs / HOUR)
  const minutes = abs % HOUR
  if (hours === 0) return `${sign}${minutes} min`
  if (minutes === 0) return `${sign}${hours} h`
  return `${sign}${hours} h ${String(minutes).padStart(2, "0")}`
}

/**
 * The badge next to every employee's name: their WEEK against their contract.
 *
 * It used to report the change made to the day on screen. Truthful about the
 * edit, and misread by everyone: a badge pinned to a NAME reads as a statement
 * about the person, not about what happened to their Thursday. So +15 minutes
 * on Tuesday and -15 on Thursday showed as "+15 min" on one tab and "-15 min"
 * on another, while the employee's week had not moved at all — the manager was
 * being warned about a deviation that did not exist.
 *
 * Now it answers the question the position asks: is this person at their
 * contracted hours? Weekly, because every contract rule in ShiftOS is weekly,
 * and stable across day tabs, because a week is not a property of a Thursday.
 * The edit itself is still reported, where it belongs — the footer's last-edit
 * line and the outline drawn around a touched shift.
 */
export function weeklyContractDeltas(
  edited: PlanningBoardInput
): ReadonlyMap<EmployeeId, ShiftDeltaVM> {
  const deltas = new Map<EmployeeId, ShiftDeltaVM>()
  for (const employee of edited.employees) {
    const planned = edited.shifts
      .filter((shift) => shift.employeeId === employee.id)
      .reduce((sum, shift) => sum + shift.workedMinutes, 0)
    const difference = planned - (employee.weeklyTargetMinutes ?? employee.contractMinutes)
    deltas.set(employee.id, {
      kind: difference === 0 ? "unchanged" : difference > 0 ? "extended" : "reduced",
      label: deltaLabel(difference),
    })
  }
  return deltas
}

// ── Verdict ──────────────────────────────────────────────────────────────────

export type DayEditVerdictKind =
  | "neutral"
  | "improvement"
  | "degradation"
  | "contract"
  | "blocking"
export type DayEditTone = "ok" | "improve" | "warn" | "block"

export interface ContractDeviationVM {
  readonly name: string
  /** The signed gap against the contract, e.g. "+15 min". */
  readonly label: string
  readonly deltaMinutes: number
}

export interface DayEditVerdictVM {
  readonly kind: DayEditVerdictKind
  readonly tone: DayEditTone
  readonly label: string
  /** The where-and-how-much line, e.g. "+2 présents (09:00 – 10:00)". */
  readonly detail: string | null
  /** Populated only for a contract verdict, so the UI can list who is off. */
  readonly deviations: readonly ContractDeviationVM[]
}

const OK: DayEditVerdictVM = {
  kind: "neutral",
  tone: "ok",
  label: "Conforme",
  detail: null,
  deviations: [],
}

function shiftsOn(input: PlanningBoardInput, date: string) {
  return input.shifts.filter((shift) => shift.date === date)
}

/** Two of one employee's shifts on this day share time. */
function dayHasOverlap(input: PlanningBoardInput, date: string): boolean {
  const byEmployee = new Map<EmployeeId, { startMinutes: number; endMinutes: number }[]>()
  for (const shift of shiftsOn(input, date)) {
    const list = byEmployee.get(shift.employeeId) ?? []
    list.push({ startMinutes: shift.startMinutes, endMinutes: shift.endMinutes })
    byEmployee.set(shift.employeeId, list)
  }
  for (const list of byEmployee.values()) {
    const sorted = list.sort((a, b) => a.startMinutes - b.startMinutes)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].endMinutes > sorted[i].startMinutes) return true
    }
  }
  return false
}

/** A shift on this day steps outside the opening window, or has an empty segment. */
function dayFallsOutside(
  input: PlanningBoardInput,
  date: string,
  open: number,
  close: number
): boolean {
  for (const shift of shiftsOn(input, date)) {
    for (const segment of shift.segments) {
      if (segment.endMinutes <= segment.startMinutes) return true
    }
    if (shift.startMinutes < open || shift.endMinutes > close) return true
  }
  return false
}

/** Any day carrying an impossible arrangement: overlap, out-of-window, or open on a closed day. */
function anyBlocking(input: PlanningBoardInput): boolean {
  for (const day of input.days) {
    if (day.closed || day.opensAtMinutes === null || day.closesAtMinutes === null) {
      if (shiftsOn(input, day.date).length > 0) return true
      continue
    }
    if (dayHasOverlap(input, day.date)) return true
    if (dayFallsOutside(input, day.date, day.opensAtMinutes, day.closesAtMinutes)) return true
  }
  return false
}

/**
 * Every employee whose planned week no longer equals their contract.
 *
 * The comparison is absolute — planned versus contracted, not planned versus a
 * previous edit — so the honest state of the schedule is what shows. A pure
 * move nets to zero here by construction, which is exactly why moving a shift
 * raises no contract flag.
 */
function contractDeviations(edited: PlanningBoardInput): ContractDeviationVM[] {
  const plannedByEmployee = new Map<EmployeeId, number>()
  for (const shift of edited.shifts) {
    plannedByEmployee.set(
      shift.employeeId,
      (plannedByEmployee.get(shift.employeeId) ?? 0) + shift.workedMinutes
    )
  }
  const deviations: ContractDeviationVM[] = []
  for (const employee of edited.employees) {
    const planned = plannedByEmployee.get(employee.id) ?? 0
    const delta = planned - (employee.weeklyTargetMinutes ?? employee.contractMinutes)
    if (delta !== 0) {
      deviations.push({ name: employee.name, label: deltaLabel(delta), deltaMinutes: delta })
    }
  }
  return deviations
}

/** Employees present through the whole hour `[start, start+60)`. */
/**
 * How many people are on the floor throughout the hour — the THINNEST moment of
 * it, not the number of shifts that happen to span it whole.
 *
 * The third place in the app to have counted containment instead of
 * concurrency, and the last to be corrected. A hand-over at 12:15 leaves two
 * people present at every instant of 12:00–13:00 while NO single shift covers
 * the hour, so the old reading saw one body and announced « Couverture
 * dégradée » over a day that had lost nothing.
 */
function presentAt(input: PlanningBoardInput, date: string, hourStart: number, sectorId: string): number {
  return minimumConcurrentPresence(
    { startMinutes: hourStart, endMinutes: hourStart + HOUR },
    shiftsOn(input, date).flatMap((shift) =>
      (shift.sectorAssignments ?? shift.segments.map((segment) => ({ ...segment, sectorId: shift.sectorId })))
        .filter((segment) => segment.sectorId === sectorId)
        .map((segment) => ({
        startMinutes: segment.startMinutes,
        endMinutes: segment.endMinutes,
      }))
    )
  )
}

/** The demand for the hour: the strongest requirement overlapping it. */
function requiredAt(input: PlanningBoardInput, date: string, hourStart: number, sectorId: string): number {
  return input.demand
    .filter(
      (slot) =>
        slot.sectorId === sectorId && slot.date === date && slot.startMinutes < hourStart + HOUR && slot.endMinutes > hourStart
    )
    .reduce((max, slot) => Math.max(max, slot.requiredEmployees), 0)
}

/**
 * The contiguous window where presence moved most in `direction`, as a label
 * like "+2 présents (09:00 – 10:00)". Consecutive hours carrying the same change
 * are merged so a two-hour extension reads as one window, not two.
 */
function bestWindow(
  deltas: readonly number[],
  hourStarts: readonly number[],
  direction: 1 | -1
): string | null {
  let best = 0
  let bestIndex = -1
  for (let i = 0; i < deltas.length; i++) {
    const value = deltas[i] * direction
    if (value > best) {
      best = value
      bestIndex = i
    }
  }
  if (bestIndex === -1) return null
  const target = deltas[bestIndex]
  let start = bestIndex
  let end = bestIndex
  while (start > 0 && deltas[start - 1] === target) start--
  while (end < deltas.length - 1 && deltas[end + 1] === target) end++
  const sign = target > 0 ? "+" : "-"
  const count = Math.abs(target)
  const from = clockLabel(hourStarts[start])
  const to = clockLabel(hourStarts[end] + HOUR)
  return `${sign}${count} présent${count > 1 ? "s" : ""} (${from} – ${to})`
}

/**
 * Grade the edited schedule against the generated original, by strict priority:
 *
 *   1. an impossible arrangement          → "Publication impossible"
 *   2. a broken contract (any employee)   → "Écart contractuel"
 *   3. coverage lost on the shown day     → "Couverture dégradée"
 *   4. coverage gained, contracts intact  → "Amélioration"
 *   5. nothing of the above               → "Conforme"
 *
 * The order is the whole point: a coverage improvement is checked LAST among the
 * good outcomes, so it can never be announced while a contract is off or the day
 * is unpublishable. Tiers 1 and 2 are weekly; coverage is read on the shown day.
 */
export function assessDayEdits(
  original: PlanningBoardInput,
  edited: PlanningBoardInput,
  date: string | null
): DayEditVerdictVM {
  if (anyBlocking(edited)) {
    return { kind: "blocking", tone: "block", label: "Publication impossible", detail: null, deviations: [] }
  }

  const deviations = contractDeviations(edited)
  if (deviations.length > 0) {
    const detail =
      deviations.length === 1
        ? `${deviations[0].name} : ${deviations[0].label} par rapport au contrat`
        : `${deviations.length} salariés hors contrat`
    return { kind: "contract", tone: "block", label: "Écart contractuel", detail, deviations }
  }

  if (date === null) return OK
  const day = edited.days.find((item) => item.date === date)
  if (!day || day.closed || day.opensAtMinutes === null || day.closesAtMinutes === null) return OK
  const open = day.opensAtMinutes
  const close = day.closesAtMinutes

  const hourCount = Math.max(0, Math.ceil((close - open) / HOUR))
  const hourStarts: number[] = []
  const presenceDelta: number[] = []
  let deficitBefore = 0
  let deficitAfter = 0
  for (let i = 0; i < hourCount; i++) {
    const hourStart = open + i * HOUR
    hourStarts.push(hourStart)
    let delta = 0
    for (const sector of edited.sectors) {
      const required = requiredAt(edited, date, hourStart, sector.id)
      const before = presentAt(original, date, hourStart, sector.id)
      const after = presentAt(edited, date, hourStart, sector.id)
      deficitBefore += Math.max(0, required - before)
      deficitAfter += Math.max(0, required - after)
      delta += after - before
    }
    presenceDelta.push(delta)
  }

  if (deficitAfter < deficitBefore) {
    return {
      kind: "improvement",
      tone: "improve",
      label: "Amélioration",
      detail: bestWindow(presenceDelta, hourStarts, 1),
      deviations: [],
    }
  }
  if (deficitAfter > deficitBefore) {
    return {
      kind: "degradation",
      tone: "warn",
      label: "Couverture dégradée",
      detail: bestWindow(presenceDelta, hourStarts, -1),
      deviations: [],
    }
  }
  return OK
}

/** True when the edits must not be published or saved: impossible, or off-contract. */
export function editsBlockPersistence(verdict: DayEditVerdictVM): boolean {
  return verdict.kind === "blocking" || verdict.kind === "contract"
}

/**
 * A one-line description of the most recent edit, for the footer:
 * "Luca Zanuso (+30 min, fin à 13:15)". Returns null when the shift is gone or
 * unchanged, so the footer can simply hide.
 */
export function describeLastEdit(
  original: PlanningBoardInput,
  edited: PlanningBoardInput,
  shiftId: string | null
): string | null {
  if (shiftId === null) return null
  const before = original.shifts.find((shift) => shift.id === shiftId)
  const after = edited.shifts.find((shift) => shift.id === shiftId)
  if (!before || !after) return null
  const employee = edited.employees.find((item) => item.id === after.employeeId)
  const name = employee?.name ?? "Salarié"
  const delta = deltaLabel(after.workedMinutes - before.workedMinutes)
  return `${name} (${delta}, fin à ${clockLabel(after.endMinutes)})`
}
