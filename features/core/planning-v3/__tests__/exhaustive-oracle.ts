import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

/**
 * A brute-force oracle, written independently of the solver.
 *
 * It shares no code with `solver/`: it enumerates its own candidates, checks
 * every rule from the problem definition, scores with its own implementation of
 * the lexicographic objective, and picks the winner by exhaustive comparison.
 * If it reused the solver's helpers it would agree with the solver by
 * construction — the same trap the independent validator exists to avoid.
 *
 * It is deliberately naive and exponential. That is affordable only because it
 * is applied to problems with a few thousand combinations.
 */

interface OracleShift {
  readonly start: number
  readonly end: number
  readonly minutes: number
}

const REST: OracleShift = { start: -1, end: -1, minutes: 0 }

export interface OracleOutcome {
  readonly feasible: boolean
  readonly objective: readonly number[] | null
  readonly key: string | null
  readonly legalSolutionCount: number
  readonly combinationsExamined: number
}

export function solveByExhaustiveOracle(problem: PlanningProblemV3): OracleOutcome {
  const employees = problem.employees
  const days = problem.days

  // ── Own candidate enumeration ───────────────────────────────────────────
  const options: OracleShift[][][] = days.map((day) =>
    employees.map((employee) => {
      const entry = problem.employeeDays.find(
        (item) => item.employeeId === employee.id && item.date === day.date
      )!
      if (!entry.available) return entry.mandatory ? [] : [REST]
      const shifts: OracleShift[] = []
      for (
        let start = entry.earliestStartMinutes;
        start <= entry.latestEndMinutes;
        start += problem.timeStepMinutes
      ) {
        for (
          let end = start + problem.timeStepMinutes;
          end <= entry.latestEndMinutes;
          end += problem.timeStepMinutes
        ) {
          const minutes = end - start
          if (minutes < problem.rules.minimumShiftMinutes) continue
          if (minutes > problem.rules.maximumShiftMinutes) continue
          if (minutes > entry.maximumMinutes) continue
          if (start === day.opensAtMinutes && !employee.canOpen) continue
          if (end === day.closesAtMinutes && !employee.canClose) continue
          shifts.push({ start, end, minutes })
        }
      }
      if (!entry.mandatory) shifts.push(REST)
      return shifts
    })
  )

  let best: number[] | null = null
  let bestKey: string | null = null
  let legalSolutionCount = 0
  let combinationsExamined = 0

  // ── Full cartesian product over every employee and every day ────────────
  const grid: OracleShift[][] = days.map(() => new Array(employees.length))

  function walk(dayIndex: number, employeeIndex: number): void {
    if (dayIndex === days.length) {
      combinationsExamined++
      const scored = scoreIfLegal(problem, grid)
      if (scored === null) return
      legalSolutionCount++
      const key = canonicalKey(problem, grid)
      if (best === null || compare(scored, best) < 0 || (compare(scored, best) === 0 && key < bestKey!)) {
        best = scored
        bestKey = key
      }
      return
    }
    if (employeeIndex === employees.length) {
      walk(dayIndex + 1, 0)
      return
    }
    for (const shift of options[dayIndex][employeeIndex]) {
      grid[dayIndex][employeeIndex] = shift
      walk(dayIndex, employeeIndex + 1)
    }
  }

  walk(0, 0)

  return {
    feasible: best !== null,
    objective: best,
    key: bestKey,
    legalSolutionCount,
    combinationsExamined,
  }
}

/** Returns the objective vector, or null when any hard rule is broken. */
function scoreIfLegal(problem: PlanningProblemV3, grid: OracleShift[][]): number[] | null {
  const employees = problem.employees
  const days = problem.days
  const totalContract = employees.reduce((sum, e) => sum + e.contractMinutes, 0)

  const weekly = employees.map(() => 0)
  const openings = employees.map(() => 0)
  const closings = employees.map(() => 0)

  let underCovered = 0
  let deficitMinutes = 0
  let avoidableSurplus = 0
  let deviation = 0
  let preference = 0

  for (const [dayIndex, day] of days.entries()) {
    let dayMinutes = 0
    let openerCount = 0
    let closerCount = 0

    for (const [employeeIndex] of employees.entries()) {
      const shift = grid[dayIndex][employeeIndex]
      dayMinutes += shift.minutes
      weekly[employeeIndex] += shift.minutes
      if (shift.minutes === 0) continue
      if (shift.start === day.opensAtMinutes) {
        openerCount++
        openings[employeeIndex]++
      }
      if (shift.end === day.closesAtMinutes) {
        closerCount++
        closings[employeeIndex]++
      }
    }

    if (dayMinutes !== day.budgetMinutes) return null
    if (openerCount < problem.rules.minimumOpeningsPerDay) return null
    if (closerCount !== problem.rules.exactClosingsPerDay) return null

    // Coverage, computed from scratch.
    const slots = problem.demandSlots.filter((slot) => slot.date === day.date)
    let dayRequired = 0
    let dayDeficit = 0
    for (const slot of slots) {
      dayRequired += slot.requiredEmployees * (slot.endMinutes - slot.startMinutes)
      let covered = 0
      for (const [employeeIndex] of employees.entries()) {
        const shift = grid[dayIndex][employeeIndex]
        if (shift.minutes > 0 && shift.start <= slot.startMinutes && shift.end >= slot.endMinutes) {
          covered++
        }
      }
      if (covered < slot.requiredEmployees) {
        underCovered++
        dayDeficit += (slot.requiredEmployees - covered) * (slot.endMinutes - slot.startMinutes)
      }
    }
    deficitMinutes += dayDeficit
    const structural = Math.max(0, day.budgetMinutes - dayRequired)
    avoidableSurplus += Math.max(0, day.budgetMinutes - (dayRequired - dayDeficit) - structural)

    for (const [employeeIndex, employee] of employees.entries()) {
      const shift = grid[dayIndex][employeeIndex]
      deviation += Math.abs(
        shift.minutes * totalContract - employee.contractMinutes * day.budgetMinutes
      )
      if (shift.minutes > 0) {
        if (employee.prefersClosing && shift.end !== day.closesAtMinutes) preference++
        if (employee.prefersOpening && shift.start !== day.opensAtMinutes) preference++
      }
    }
  }

  // Weekly rules.
  for (const [employeeIndex, employee] of employees.entries()) {
    if (weekly[employeeIndex] !== employee.contractMinutes) return null
    if (employee.maximumOpenings !== null && openings[employeeIndex] > employee.maximumOpenings) return null
    if (employee.maximumClosings !== null && closings[employeeIndex] > employee.maximumClosings) return null

    let previousDay = -1
    let previousEnd = -1
    let streak = 0
    for (const [dayIndex] of days.entries()) {
      const shift = grid[dayIndex][employeeIndex]
      if (shift.minutes === 0) {
        previousDay = -1
        streak = 0
        continue
      }
      if (previousDay >= 0) {
        const rest = (dayIndex - previousDay) * 1_440 - previousEnd + shift.start
        if (rest < problem.rules.minimumRestMinutes) return null
      }
      streak = previousDay === dayIndex - 1 ? streak + 1 : 1
      if (
        problem.rules.maximumConsecutiveWorkedDays !== null &&
        streak > problem.rules.maximumConsecutiveWorkedDays
      ) {
        return null
      }
      previousDay = dayIndex
      previousEnd = shift.end
    }
  }

  const fairness = spread(openings) + spread(closings)
  return [0, underCovered, deficitMinutes, 0, 0, avoidableSurplus, deviation, preference, fairness]
}

function canonicalKey(problem: PlanningProblemV3, grid: OracleShift[][]): string {
  const rows: string[] = []
  for (const [dayIndex, day] of problem.days.entries()) {
    for (const [employeeIndex, employee] of problem.employees.entries()) {
      const shift = grid[dayIndex][employeeIndex]
      if (shift.minutes === 0) continue
      rows.push(`${day.date}|${String(employee.id)}|${shift.start}-${shift.end}`)
    }
  }
  return rows.sort().join(";")
}

function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index++) {
    const difference = left[index] - right[index]
    if (difference !== 0) return difference
  }
  return 0
}

function spread(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values)
}
