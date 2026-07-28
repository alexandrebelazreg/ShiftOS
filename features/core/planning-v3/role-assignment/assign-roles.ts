import type { EmployeeId, IsoDate } from "@/features/core/models"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"

/**
 * Role propagation — Coffre / Accueil / Caisse.
 *
 * DELIBERATELY SEPARATE from every shift solver, and not wired into any
 * pipeline by this sprint.
 *
 * The separation is a design decision, not an omission. Roles are decided
 * AFTER the hours: which post someone stands at changes nothing about whether
 * the schedule is legal — not the contract, not the rest, not the coverage —
 * so folding roles into the search would add a dimension to a combinatorial
 * problem in exchange for no additional legality. Worse, it would make the two
 * inseparable: a change to the safe-room rule would then require re-validating
 * every hour of every schedule.
 *
 * As a pure function over a finished solution, it can be tested exhaustively on
 * its own, applied or not applied without touching the engine, and replaced
 * wholesale when the roles change — which they will, because they are the part
 * of this domain that varies by store.
 *
 * The rules implemented, exactly as stated:
 *
 * - whoever opens is in `Coffre` for the first hour, then moves to `Accueil`;
 * - Monday to Friday, when two people overlap, the SECOND to arrive goes to
 *   `Caisse`;
 * - on Saturday everyone stays in `Accueil`.
 *
 * "The second to arrive" is resolved by start time, then — for a genuine tie —
 * by employee id, so the result is deterministic rather than dependent on the
 * order the assignments happen to be in.
 */

export const PLANNING_ROLES = ["Coffre", "Accueil", "Caisse"] as const
export type PlanningRole = (typeof PLANNING_ROLES)[number]

/** How long the opener stays in the safe room before moving to the desk. */
export const COFFRE_MINUTES = 60

/** One interval of one employee's day, with the post they hold during it. */
export interface RoleInterval {
  readonly employeeId: EmployeeId
  readonly date: IsoDate
  readonly startMinutes: number
  readonly endMinutes: number
  readonly role: PlanningRole
}

export interface RoleAssignmentInput {
  readonly solution: PlanningSolutionV3
  /** Opening minute per date. A date absent from the map has no opener. */
  readonly opensAtByDate: Readonly<Record<string, number>>
  /** Dates on which everyone stays at `Accueil` — Saturdays, in the stated rule. */
  readonly accueilOnlyDates: readonly IsoDate[]
}

export function assignRoles(input: RoleAssignmentInput): readonly RoleInterval[] {
  const accueilOnly = new Set<string>(input.accueilOnlyDates)
  const intervals: RoleInterval[] = []

  const byDate = new Map<string, typeof input.solution.assignments>()
  for (const assignment of input.solution.assignments) {
    const existing = byDate.get(assignment.date) ?? []
    byDate.set(assignment.date, [...existing, assignment])
  }

  // Dates in calendar order, so the output is stable whatever order the
  // solution listed them in.
  for (const date of [...byDate.keys()].sort()) {
    const assignments = [...(byDate.get(date) ?? [])].sort((left, right) => {
      const leftStart = left.segments[0]?.startMinutes ?? 0
      const rightStart = right.segments[0]?.startMinutes ?? 0
      return leftStart - rightStart || String(left.employeeId).localeCompare(String(right.employeeId))
    })

    const opensAt = input.opensAtByDate[date]
    const isAccueilOnly = accueilOnly.has(date)

    assignments.forEach((assignment, arrivalRank) => {
      const firstSegment = assignment.segments[0]
      const opensDay = firstSegment !== undefined && firstSegment.startMinutes === opensAt

      for (const segment of assignment.segments) {
        // The safe room, held only by the opener and only at the very start of
        // their day. A split shift's later segment never re-enters it.
        if (opensDay && segment === firstSegment && !isAccueilOnly) {
          const coffreEnd = Math.min(segment.startMinutes + COFFRE_MINUTES, segment.endMinutes)
          intervals.push({
            employeeId: assignment.employeeId,
            date: date as IsoDate,
            startMinutes: segment.startMinutes,
            endMinutes: coffreEnd,
            role: "Coffre",
          })
          if (coffreEnd < segment.endMinutes) {
            intervals.push({
              employeeId: assignment.employeeId,
              date: date as IsoDate,
              startMinutes: coffreEnd,
              endMinutes: segment.endMinutes,
              role: "Accueil",
            })
          }
          continue
        }

        // Saturday keeps everyone at the desk. Otherwise the second arrival of
        // a doubled-up day takes the till.
        const role: PlanningRole =
          !isAccueilOnly && arrivalRank === 1 && assignments.length > 1 ? "Caisse" : "Accueil"

        intervals.push({
          employeeId: assignment.employeeId,
          date: date as IsoDate,
          startMinutes: segment.startMinutes,
          endMinutes: segment.endMinutes,
          role,
        })
      }
    })
  }

  return intervals
}
