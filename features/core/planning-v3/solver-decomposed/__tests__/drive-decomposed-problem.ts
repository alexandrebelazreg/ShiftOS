import type { EmployeeId } from "@/features/core/models"
import type {
  PlanningDemandSlotV3,
  PlanningEmployeeDayV3,
  PlanningProblemV3,
} from "@/features/core/planning-v3/types/problem"
import { buildDriveProblem } from "@/features/core/planning-v3/__tests__/drive-problem"

/**
 * The Drive week, with the two facts the decomposed engine was asked to honour
 * and the existing fixture cannot yet express.
 *
 * Both are applied to the BUILT `PlanningProblemV3` rather than to the
 * application payload upstream of it, and that is deliberate:
 *
 * - `PlanningEmployeeDayV3.earliestStartMinutes` exists in the model, the
 *   candidate generators honour it and the validator enforces it as blocking —
 *   but no application constraint produces a narrowed value yet, so
 *   `build-problem.ts` writes the sector's opening for everyone. The seam is
 *   there (`individualEarliestStart`); the constraint type, its form and its
 *   migration are a sprint of their own. Setting the value here exercises the
 *   whole chain below the seam without shipping an interface no screen can fill.
 *
 * - `PlanningDemandSlotV3.hardMinimumEmployees` is new this sprint. The builder
 *   does not populate it either, for the same reason: nothing in the sector
 *   configuration distinguishes an operational floor from a demand target yet.
 *
 * Neither is a shortcut around a rule. Both produce a problem the OFFICIAL
 * validator then checks in full, which is the only authority that matters.
 */

/** Dylan does not start before 08:00. */
export const DYLAN_EARLIEST_START_MINUTES = 480

/**
 * At least one person on the floor at every instant the Drive is open.
 *
 * The unbreakable minimum, as opposed to the hourly head-count profile, which
 * is a target. A schedule missing the target is short-staffed; a schedule
 * missing this one has left the Drive unattended.
 */
export const DRIVE_HARD_FLOOR = 1

export function buildDecomposedDriveProblem(): PlanningProblemV3 {
  const base = buildDriveProblem()

  const employeeDays: PlanningEmployeeDayV3[] = base.employeeDays.map((entry) =>
    String(entry.employeeId) === "dylan"
      ? {
          ...entry,
          // Narrowed, never widened: the individual bound intersects the
          // sector's window, it does not replace it.
          earliestStartMinutes: Math.max(entry.earliestStartMinutes, DYLAN_EARLIEST_START_MINUTES),
          maximumMinutes: Math.min(
            entry.maximumMinutes,
            Math.max(
              0,
              entry.latestEndMinutes -
                Math.max(entry.earliestStartMinutes, DYLAN_EARLIEST_START_MINUTES)
            )
          ),
        }
      : entry
  )

  const demandSlots: PlanningDemandSlotV3[] = base.demandSlots.map((slot) => ({
    ...slot,
    hardMinimumEmployees: DRIVE_HARD_FLOOR,
  }))

  return { ...base, employeeDays, demandSlots }
}

export function dylanId(problem: PlanningProblemV3): EmployeeId {
  const dylan = problem.employees.find((employee) => String(employee.id) === "dylan")
  if (!dylan) throw new Error("La fixture Drive ne contient pas Dylan.")
  return dylan.id
}
