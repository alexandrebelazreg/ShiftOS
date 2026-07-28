import type { Allocation } from "@/features/core/planning-v3/solver-decomposed/types"
import type { NormalisedProblem } from "@/features/core/planning-v3/solver-decomposed/diagnostics/normalise"

/**
 * Phase 2 — how many minutes each employee owes on each day.
 *
 * The question this phase answers, exactly: find an integer matrix `M` with
 *
 *   row sums    `Σ_d M[e][d] = contractMinutes(e)`      — the contract, exactly
 *   column sums `Σ_e M[e][d] = budgetMinutes(d)`        — the day budget, exactly
 *   each cell   `M[e][d] = 0` or `minDaily(e) ≤ M[e][d] ≤ capacity(e,d)`
 *   every cell a multiple of the time step
 *
 * That is a transportation problem with SEMI-CONTINUOUS cells: a day is either
 * a rest day or a real shift, never a token twenty minutes. The semi-continuity
 * is what makes it combinatorial rather than a flow, and it is also what makes
 * it the right decomposition — once `M` is fixed, every later phase deals with
 * durations that are already decided, which is precisely what collapses the
 * candidate space in Phase 4.
 *
 * Both sums are EXACT because the model says so: the validator checks a day's
 * worked minutes against its budget and an employee's weekly minutes against
 * their contract, and both as blocking rules. This phase therefore cannot
 * "mostly" balance — Phase 1 has already proven the two totals agree.
 *
 * The generator is LAZY and ORDERED. It yields allocations best-first under a
 * proportional target, so the caller can take one, try to place it, and come
 * back for the next without ever materialising a space that is exponential in
 * the number of cells. Rank 0 is the most balanced allocation, and a caller
 * that consumes exactly one still gets a sensible week.
 *
 * Determinism: every ordering below is total and value-based. No `Map`
 * iteration, no clock, no randomness.
 */

interface Cell {
  readonly minimum: number
  readonly maximum: number
  readonly mandatory: boolean
  /**
   * The largest duration this employee can work in ONE stretch on this day.
   *
   * Allocating above it does not break a rule — it forces a split, which is
   * legal for someone allowed to split. But a split punches a hole of up to
   * `maximumSplitMinutes` in the middle of that person's day, and on a thinly
   * staffed day there may be nobody to cover it.
   */
  readonly continuousMaximum: number
}

export function* generateAllocations(
  normalised: NormalisedProblem,
  limit: number
): Generator<Allocation> {
  const { employees, days, entries, capacity, rules } = normalised
  const step = rules.timeStepMinutes
  const employeeCount = employees.length
  const dayCount = days.length

  const cells: Cell[][] = employees.map((employee, employeeIndex) =>
    days.map((_day, dayIndex) => ({
      minimum: ceilToStep(
        Math.max(rules.minimumShiftMinutes, employee.minimumDailyMinutes),
        step
      ),
      maximum: capacity[employeeIndex][dayIndex],
      mandatory: entries[employeeIndex][dayIndex].mandatory,
      continuousMaximum: Math.min(capacity[employeeIndex][dayIndex], rules.maximumContinuousMinutes),
    }))
  )

  // Suffix capacity per employee: the most minutes they can still absorb from
  // day `d` onward. The pruning below leans on it constantly, so it is computed
  // once instead of re-summed at every node.
  const suffixCapacity: number[][] = employees.map((_employee, employeeIndex) => {
    const suffix = new Array<number>(dayCount + 1).fill(0)
    for (let dayIndex = dayCount - 1; dayIndex >= 0; dayIndex--) {
      suffix[dayIndex] = suffix[dayIndex + 1] + capacity[employeeIndex][dayIndex]
    }
    return suffix
  })

  const remainingContract = employees.map((employee) => employee.contractMinutes)
  const matrix: number[][] = employees.map(() => new Array<number>(dayCount).fill(0))

  let yielded = 0

  /**
   * Distribute one day's budget across employees, then move to the next day.
   *
   * Employees are visited in normalised index order, which is what makes two
   * runs on the same input produce the same matrix.
   */
  function* fillDay(dayIndex: number): Generator<Allocation> {
    if (yielded >= limit) return
    if (dayIndex === dayCount) {
      // Every column balanced; the rows balance iff nothing is left owing.
      if (remainingContract.some((value) => value !== 0)) return
      yield {
        minutes: matrix.map((row) => [...row]),
        rank: yielded,
      }
      yielded++
      return
    }

    yield* fillCell(dayIndex, 0, days[dayIndex].budgetMinutes)
  }

  function* fillCell(
    dayIndex: number,
    employeeIndex: number,
    budgetLeft: number
  ): Generator<Allocation> {
    if (yielded >= limit) return

    if (employeeIndex === employeeCount) {
      if (budgetLeft !== 0) return
      yield* fillDay(dayIndex + 1)
      return
    }

    // Optimistic bound: can the employees still to be visited today absorb what
    // is left of the budget? If not, this branch is dead regardless of choice.
    let remainingDayCapacity = 0
    for (let index = employeeIndex; index < employeeCount; index++) {
      remainingDayCapacity += Math.min(cells[index][dayIndex].maximum, remainingContract[index])
    }
    if (remainingDayCapacity < budgetLeft) return

    const cell = cells[employeeIndex][dayIndex]
    const ceiling = Math.min(cell.maximum, remainingContract[employeeIndex], budgetLeft)

    // How much the employees still to be visited today could absorb WITHOUT any
    // of them being pushed past their continuous cap. Needed as a look-ahead:
    // choosing this cell's value decides what is left for them, and a value
    // that leaves more than this forces somebody downstream into a split.
    let continuousAfter = 0
    for (let index = employeeIndex + 1; index < employeeCount; index++) {
      continuousAfter += Math.min(cells[index][dayIndex].continuousMaximum, remainingContract[index])
    }

    for (const minutes of orderedChoices(dayIndex, employeeIndex, cell, ceiling, budgetLeft, continuousAfter)) {
      matrix[employeeIndex][dayIndex] = minutes
      remainingContract[employeeIndex] -= minutes

      // The row must still be closable with the days that remain, and a
      // leftover smaller than one minimum shift can never be placed at all.
      const owed = remainingContract[employeeIndex]
      const closable =
        owed >= 0 &&
        owed <= suffixCapacity[employeeIndex][dayIndex + 1] &&
        (owed === 0 || owed >= cell.minimum)

      if (closable) yield* fillCell(dayIndex, employeeIndex + 1, budgetLeft - minutes)

      remainingContract[employeeIndex] += minutes
      matrix[employeeIndex][dayIndex] = 0
      if (yielded >= limit) return
    }
  }

  /**
   * The values one cell may take, best-first.
   *
   * The target is proportional: an employee owing a third of the minutes still
   * unplaced should carry about a third of today's budget. Ordering by distance
   * to it is what makes rank 0 a BALANCED week rather than one where the first
   * employee is loaded to their ceiling and the last one rests all week.
   *
   * DURATIONS THAT FIT IN ONE STRETCH COME FIRST, whatever the target says.
   * That ordering is not cosmetic. A duration above the continuous cap forces a
   * split, and a split removes its holder from the floor for up to ninety
   * minutes in the middle of the day. On the Accueil week, allocating Marine
   * ten hours on a Tuesday staffed by exactly two people left a forty-five
   * minute hole nobody could cover, and every one of the forty allocations
   * tried failed for that single reason. A split must be a CONSEQUENCE of a
   * duration nothing else can absorb, never a side effect of rounding.
   *
   * Ties break toward the LONGER shift, then toward rest last. Two cells the
   * same distance from target are otherwise indistinguishable, and an arbitrary
   * tie-break is how determinism quietly dies.
   */
  function orderedChoices(
    dayIndex: number,
    employeeIndex: number,
    cell: Cell,
    ceiling: number,
    budgetLeft: number,
    continuousAfter: number
  ): number[] {
    const choices: number[] = []
    const low = Math.max(cell.minimum, step)
    for (let minutes = ceilToStep(low, step); minutes <= ceiling; minutes += step) {
      choices.push(minutes)
    }

    let totalOwed = 0
    for (let index = employeeIndex; index < employeeCount; index++) totalOwed += remainingContract[index]
    const share =
      totalOwed > 0 ? (remainingContract[employeeIndex] / totalOwed) * days[dayIndex].budgetMinutes : 0
    const target = roundToStep(share, step)

    /**
     * How many splits this choice makes unavoidable — here and downstream.
     *
     * Both halves matter, and the second is the one that was missing. Employees
     * are visited in index order, so by the time the last one of a two-person
     * day is reached their value is already FORCED by the budget: ordering
     * their own choices does nothing. On the Accueil Tuesday, Brigitte was
     * picked first at 300 minutes, which left Marine exactly 600 — over her
     * eight-hour continuous cap — and no ordering applied to Marine could
     * undo it. The look-ahead is what lets Brigitte's choice be judged by what
     * it leaves behind.
     */
    const splitPressure = (minutes: number): number =>
      (minutes > cell.continuousMaximum ? 1 : 0) +
      (budgetLeft - minutes > continuousAfter ? 1 : 0)

    choices.sort(
      (left, right) =>
        splitPressure(left) - splitPressure(right) ||
        Math.abs(left - target) - Math.abs(right - target) ||
        right - left
    )

    // Rest is a real option, but the LAST one: a week that rests someone it did
    // not have to rest is a week that has to overload someone else.
    if (!cell.mandatory && remainingContract[employeeIndex] <= suffixCapacity[employeeIndex][dayIndex + 1]) {
      choices.push(0)
    }
    return choices
  }

  yield* fillDay(0)
}

function ceilToStep(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step
}
