import type { Allocation } from "@/features/core/planning-v3/solver-decomposed/types"
import type { NormalisedProblem } from "@/features/core/planning-v3/solver-decomposed/diagnostics/normalise"

/**
 * Steps 1 and 2 — what the week looks like BEFORE any role is handed out.
 *
 * The skeleton generator this feeds used to walk the week Monday-first and hand
 * each duty to whoever had taken the fewest so far. That is a fair rule and a
 * blind one: it spends a scarce capability on a day that had three alternatives
 * and then discovers, four days later, that a day with one alternative has none
 * left. Measured on the Drive week, exactly that happened — the single opening
 * of a capped employee went to a Tuesday needing two openers out of three
 * candidates, and Thursday was left with one candidate for a demand of two.
 *
 * So this module answers two questions first:
 *
 * - WHICH DAYS ARE TIGHT — how many people could open, how many could close,
 *   and how much is actually demanded at those two instants. A day whose pool
 *   barely covers its demand has to be served before a comfortable one.
 * - WHICH CAPABILITIES ARE SCARCE — how many days an employee could open, how
 *   many of those days actually need them, and how many openings their cap
 *   still allows. A capability that is needed more often than it may be used is
 *   scarce, and must not be spent where alternatives exist.
 *
 * Everything here is derived from the problem and the allocation. No employee,
 * no weekday and no scenario is named anywhere.
 */

export interface DayAnalysis {
  readonly dayIndex: number
  readonly opensAtMinutes: number
  readonly closesAtMinutes: number
  /** People wanted at the exact opening instant: the floor, raised by demand. */
  readonly openingDemand: number
  /** People required at the exact closing instant. Exact, not a floor. */
  readonly closingDemand: number
  /** Employees whose allocation lets them hold the opening, in index order. */
  readonly openerPool: readonly number[]
  readonly closerPool: readonly number[]
  /** Pool minus demand. Zero means every candidate is needed; negative, short. */
  readonly openerMargin: number
  readonly closerMargin: number
  /** Highest head-count demanded at any moment of the day. */
  readonly peakDemand: number
  /** Employees the allocation put on this day at all. */
  readonly workingCount: number
}

export interface RoleScarcity {
  readonly employeeIndex: number
  /** Days this employee could open, given the allocation. */
  readonly openableDays: readonly number[]
  /** Of those, the days that actually demand an opener. */
  readonly usefulOpenDays: readonly number[]
  readonly closableDays: readonly number[]
  /** `Number.POSITIVE_INFINITY` when the employee has no declared cap. */
  readonly openingCap: number
  readonly closingCap: number
  /**
   * How contended this capability is: useful days per permitted use.
   *
   * Above 1 means the employee is wanted on more days than they may serve —
   * every use spends something that another day will miss. At or below 1 the
   * capability is abundant and may be spent freely. Infinity for an employee
   * who may not use the role at all, so they sort last and are never chosen.
   */
  readonly openingContention: number
  readonly closingContention: number
}

export interface WeekAnalysis {
  readonly openDays: readonly number[]
  readonly byDay: ReadonlyMap<number, DayAnalysis>
  readonly scarcity: readonly RoleScarcity[]
  /**
   * Day indexes ordered most-critical-first.
   *
   * Criticality is the pair (opener margin, closer margin), smallest first,
   * with the larger opening demand breaking ties: a day that can barely be
   * staffed constrains every other day's choices, so it must claim its people
   * while there are still people to claim.
   */
  readonly criticalOrder: readonly number[]
}

export function analyseWeek(
  normalised: NormalisedProblem,
  allocation: Allocation
): WeekAnalysis {
  const { employees, days, entries, rules, slotsByDay } = normalised

  const openDays: number[] = []
  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    if (!days[dayIndex].closed) openDays.push(dayIndex)
  }

  const byDay = new Map<number, DayAnalysis>()

  for (const dayIndex of openDays) {
    const day = days[dayIndex]
    const opensAt = day.opensAtMinutes ?? 0
    const closesAt = day.closesAtMinutes ?? 0

    const openerPool: number[] = []
    const closerPool: number[] = []
    let workingCount = 0

    for (let employeeIndex = 0; employeeIndex < employees.length; employeeIndex++) {
      const minutes = allocation.minutes[employeeIndex][dayIndex]
      if (minutes <= 0) continue
      workingCount++

      const employee = employees[employeeIndex]
      const entry = entries[employeeIndex][dayIndex]

      // Eligible only if the allocated minutes actually REACH the boundary from
      // inside the employee's own window. Someone who may not start before
      // 08:00 cannot hold a 06:00 opening, and no placement will fix that.
      if (
        employee.canOpen &&
        entry.earliestStartMinutes <= opensAt &&
        opensAt + minutes <= entry.latestEndMinutes
      ) {
        openerPool.push(employeeIndex)
      }
      if (
        employee.canClose &&
        entry.latestEndMinutes >= closesAt &&
        closesAt - minutes >= entry.earliestStartMinutes
      ) {
        closerPool.push(employeeIndex)
      }
    }

    let openingDemand = rules.minimumOpeningsPerDay
    let peakDemand = 0
    for (const slot of slotsByDay[dayIndex]) {
      peakDemand = Math.max(peakDemand, slot.requiredEmployees)
      if (slot.startMinutes === opensAt) {
        openingDemand = Math.max(
          openingDemand,
          slot.requiredEmployees,
          slot.hardMinimumEmployees ?? 0
        )
      }
    }

    byDay.set(dayIndex, {
      dayIndex,
      opensAtMinutes: opensAt,
      closesAtMinutes: closesAt,
      openingDemand,
      closingDemand: rules.exactClosingsPerDay,
      openerPool,
      closerPool,
      openerMargin: openerPool.length - openingDemand,
      closerMargin: closerPool.length - rules.exactClosingsPerDay,
      peakDemand,
      workingCount,
    })
  }

  // ── Step 2: how contended each capability is ────────────────────────────
  const scarcity: RoleScarcity[] = employees.map((employee, employeeIndex) => {
    const openableDays: number[] = []
    const usefulOpenDays: number[] = []
    const closableDays: number[] = []

    for (const dayIndex of openDays) {
      const analysis = byDay.get(dayIndex)
      if (!analysis) continue
      if (analysis.openerPool.includes(employeeIndex)) {
        openableDays.push(dayIndex)
        if (analysis.openingDemand > 0) usefulOpenDays.push(dayIndex)
      }
      if (analysis.closerPool.includes(employeeIndex)) closableDays.push(dayIndex)
    }

    const openingCap = employee.maximumOpenings ?? Number.POSITIVE_INFINITY
    const closingCap = employee.maximumClosings ?? Number.POSITIVE_INFINITY

    return {
      employeeIndex,
      openableDays,
      usefulOpenDays,
      closableDays,
      openingCap,
      closingCap,
      openingContention: contention(usefulOpenDays.length, openingCap),
      closingContention: contention(closableDays.length, closingCap),
    }
  })

  // Most critical first. Total and value-based, so two runs agree.
  const criticalOrder = [...openDays].sort((left, right) => {
    const a = byDay.get(left)!
    const b = byDay.get(right)!
    return (
      a.openerMargin - b.openerMargin ||
      a.closerMargin - b.closerMargin ||
      b.openingDemand - a.openingDemand ||
      left - right
    )
  })

  return { openDays, byDay, scarcity, criticalOrder }
}

/**
 * Useful days per permitted use.
 *
 * An employee wanted on four days who may serve one is four times contended; an
 * employee wanted on two days with no cap is not contended at all. A capability
 * that may never be used returns Infinity, which sorts it last everywhere and
 * keeps it from being picked.
 */
function contention(usefulDays: number, cap: number): number {
  if (cap <= 0) return Number.POSITIVE_INFINITY
  if (!Number.isFinite(cap)) return usefulDays === 0 ? 0 : 1
  return usefulDays / cap
}

/**
 * Would closing `closeDay` stop this employee from opening `openDay`?
 *
 * The rest rule reads consecutive worked days, and both times are fixed by the
 * skeleton, so the clash is fully decidable here rather than discovered by a
 * placement that then has no candidate at all.
 */
export function restConflict(
  normalised: NormalisedProblem,
  closeDay: number,
  openDay: number
): boolean {
  if (openDay <= closeDay) return false
  const closesAt = normalised.days[closeDay].closesAtMinutes ?? 0
  const opensAt = normalised.days[openDay].opensAtMinutes ?? 0
  const rest = (openDay - closeDay) * 1_440 - closesAt + opensAt
  return rest < normalised.rules.minimumRestMinutes
}
