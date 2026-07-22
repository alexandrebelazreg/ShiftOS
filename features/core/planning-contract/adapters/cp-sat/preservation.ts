import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import type { PlanningBaselineShiftV3 } from "@/features/core/planning-contract/types/baseline"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import { requestedPreservations } from "@/features/core/planning-contract/types/solve-request"
import type { CpSatPinnedAssignment } from "@/features/core/planning-contract/adapters/cp-sat/protocol"

/**
 * Turn "keep shift s_42" into "this employee, this day, these exact minutes".
 *
 * Pure, and deliberately kept on the TypeScript side of the process boundary:
 * it is the part of CP-SAT integration most likely to be wrong, and it is the
 * part that needs no solver to test. Every branch below is reachable from a
 * unit test in milliseconds.
 *
 * ONE RULE governs everything here: a preservation this adapter cannot turn
 * into a hard constraint stops the request. It is never dropped, never
 * approximated to the nearest legal shift, and never solved around.
 *
 * That is stricter than the contract requires — the contract lets an engine
 * answer `feasible` while reporting a lock it could not keep, and the DFS
 * prototype does exactly that. CP-SAT is held to a higher standard because it
 * CAN express these constraints: if it returns a schedule at all, that schedule
 * honours every demand it was given. So "we could not keep your pinned shift"
 * is a refusal to answer, not a footnote on an answer, and there is no path
 * through this module that quietly solves a looser problem than the one asked.
 */

/** Which kind of local work a demand protects. Carried into every diagnostic. */
export type PreservationKind = "lock" | "manual-edit"

export type PreservationIssueReason =
  | "shift-absent-from-baseline"
  | "employee-absent-from-problem"
  | "date-absent-from-problem"
  | "employee-unavailable-that-day"
  | "split-shift-not-expressible"
  | "geometry-inverted"
  | "geometry-not-on-time-step"
  | "geometry-outside-day-window"
  | "duration-outside-shift-bounds"

export interface PreservationIssue {
  readonly kind: PreservationKind
  readonly shiftId: string
  readonly reason: PreservationIssueReason
  readonly message: string
}

export interface PreservationPlan {
  readonly lockedAssignments: readonly CpSatPinnedAssignment[]
  readonly editedAssignments: readonly CpSatPinnedAssignment[]
  readonly baselineAssignments: readonly CpSatPinnedAssignment[]
  readonly minimizeOtherChanges: boolean
  /**
   * Local work was submitted for protection with no usable reference schedule.
   *
   * Fatal, and checked before anything else: an id without the schedule that
   * minted it names nothing, so there is no honest way to solve this request.
   */
  readonly missingBaseline: boolean
  /**
   * Every demand that could not become a hard constraint. Fatal, all of them.
   */
  readonly unresolved: readonly PreservationIssue[]
  /** True when stability was asked for but there is nothing to measure against. */
  readonly stabilityUnmeasurable: boolean
}

const EMPTY_PLAN: PreservationPlan = {
  lockedAssignments: [],
  editedAssignments: [],
  baselineAssignments: [],
  minimizeOtherChanges: false,
  missingBaseline: false,
  unresolved: [],
  stabilityUnmeasurable: false,
}

export function buildPreservationPlan(request: SolvePlanningRequest): PreservationPlan {
  const regeneration = request.regeneration
  if (regeneration === undefined) return EMPTY_PLAN

  const { problem, baseline } = request
  const requested = requestedPreservations(request)
  // "Usable" means it can actually resolve an id. An empty reference schedule
  // is as useless as none at all, so the two are not told apart here.
  const usableBaseline = baseline !== undefined && baseline.shifts.length > 0

  // A bare flag with nothing behind it asks for nothing, and must not demand a
  // baseline: "preserve my locks" with no locks is satisfied by any schedule.
  if ((requested.locks || requested.manualEdits) && !usableBaseline) {
    return {
      ...EMPTY_PLAN,
      minimizeOtherChanges: regeneration.minimizeOtherChanges,
      missingBaseline: true,
      stabilityUnmeasurable: regeneration.minimizeOtherChanges,
    }
  }

  const baselineByShiftId = new Map<string, PlanningBaselineShiftV3>(
    (baseline?.shifts ?? []).map((shift) => [shift.shiftId, shift])
  )
  const employeeIds = new Set(problem.employees.map((employee) => String(employee.id)))
  const dayByDate = new Map(problem.days.map((day) => [day.date, day]))
  const entryByKey = new Map(
    problem.employeeDays.map((entry) => [`${String(entry.employeeId)}|${entry.date}`, entry])
  )

  const lockedAssignments: CpSatPinnedAssignment[] = []
  const editedAssignments: CpSatPinnedAssignment[] = []
  const unresolved: PreservationIssue[] = []

  if (regeneration.preserveLockedShifts) {
    for (const shiftId of regeneration.lockedShiftIds) {
      const shift = baselineByShiftId.get(shiftId)
      if (shift === undefined) {
        unresolved.push(absent("lock", shiftId))
        continue
      }
      // A lock reproduces the baseline geometry EXACTLY — same employee, same
      // day, same start, same end, same segments. Which is why a split shift
      // cannot be locked: the model enumerates continuous shifts only, so no
      // candidate reproduces two segments, and pinning the span instead would
      // be a different shift wearing the same id.
      const issue = describeShift(shift, employeeIds, dayByDate)
      if (issue !== null) {
        unresolved.push({ kind: "lock", shiftId, ...issue })
        continue
      }
      const [segment] = shift.segments
      lockedAssignments.push(pin(shiftId, shift, segment.startMinutes, segment.endMinutes))
    }
  }

  if (regeneration.preserveManualEdits) {
    for (const edit of regeneration.editedShifts) {
      const shift = baselineByShiftId.get(edit.shiftId)
      if (shift === undefined) {
        unresolved.push(absent("manual-edit", edit.shiftId))
        continue
      }
      const structural = describeShift(shift, employeeIds, dayByDate, { allowSplit: true })
      if (structural !== null) {
        unresolved.push({ kind: "manual-edit", shiftId: edit.shiftId, ...structural })
        continue
      }
      const geometry = describeGeometry(problem, shift, edit.startMinute, edit.endMinute, entryByKey)
      if (geometry !== null) {
        unresolved.push({ kind: "manual-edit", shiftId: edit.shiftId, ...geometry })
        continue
      }
      editedAssignments.push(pin(edit.shiftId, shift, edit.startMinute, edit.endMinute))
    }
  }

  return {
    lockedAssignments,
    editedAssignments,
    baselineAssignments: stabilityBaseline(request, employeeIds, dayByDate),
    minimizeOtherChanges: regeneration.minimizeOtherChanges,
    missingBaseline: false,
    unresolved,
    stabilityUnmeasurable: regeneration.minimizeOtherChanges && !usableBaseline,
  }
}

/** Everything actually pinned, for a diagnostic that has to name them. */
export function pinnedPreservations(
  plan: PreservationPlan
): readonly { readonly kind: PreservationKind; readonly shiftId: string }[] {
  return [
    ...plan.lockedAssignments.map((entry) => ({ kind: "lock" as const, shiftId: entry.shiftId })),
    ...plan.editedAssignments.map((entry) => ({
      kind: "manual-edit" as const,
      shiftId: entry.shiftId,
    })),
  ]
}

function absent(kind: PreservationKind, shiftId: string): PreservationIssue {
  return {
    kind,
    shiftId,
    reason: "shift-absent-from-baseline",
    message: `Le shift « ${shiftId} » n'existe pas dans le planning de référence.`,
  }
}

/**
 * The schedule drift is measured from: the one the manager is looking at.
 *
 * Which is the generated week WITH their retouches applied, not the untouched
 * output of the last run. "Do not move what I did not touch" is measured
 * against what is on their screen; using the pre-edit geometry would count
 * their own deliberate change as drift and push the solver to undo it.
 */
function stabilityBaseline(
  request: SolvePlanningRequest,
  employeeIds: ReadonlySet<string>,
  dayByDate: ReadonlyMap<string, PlanningProblemV3["days"][number]>
): readonly CpSatPinnedAssignment[] {
  if (request.baseline === undefined) return []

  const editByShiftId = new Map(
    (request.regeneration?.editedShifts ?? []).map((edit) => [edit.shiftId, edit])
  )

  const out: CpSatPinnedAssignment[] = []
  for (const shift of request.baseline.shifts) {
    if (!employeeIds.has(String(shift.employeeId)) || !dayByDate.has(shift.date)) continue
    if (shift.segments.length === 0) continue
    const edit = editByShiftId.get(shift.shiftId)
    // A split shift still contributes to drift, measured on its span: the model
    // cannot reproduce it, but "this person used to be here from 8 to 18" is
    // still the right thing for the rest of the week to stay close to.
    const start = edit?.startMinute ?? shift.segments[0].startMinutes
    const end = edit?.endMinute ?? shift.segments[shift.segments.length - 1].endMinutes
    out.push(pin(shift.shiftId, shift, start, end))
  }
  return out
}

function pin(
  shiftId: string,
  shift: PlanningBaselineShiftV3,
  startMinutes: number,
  endMinutes: number
): CpSatPinnedAssignment {
  return {
    shiftId,
    employeeId: String(shift.employeeId),
    date: shift.date,
    startMinutes,
    endMinutes,
  }
}

/** Whether the baseline shift itself can be spoken about in this problem. */
function describeShift(
  shift: PlanningBaselineShiftV3,
  employeeIds: ReadonlySet<string>,
  dayByDate: ReadonlyMap<string, PlanningProblemV3["days"][number]>,
  options: { readonly allowSplit?: boolean } = {}
): Omit<PreservationIssue, "shiftId" | "kind"> | null {
  if (!employeeIds.has(String(shift.employeeId))) {
    return {
      reason: "employee-absent-from-problem",
      message: `Le salarié ${String(shift.employeeId)} ne fait pas partie de ce problème.`,
    }
  }
  const day = dayByDate.get(shift.date)
  if (day === undefined || day.closed) {
    return {
      reason: "date-absent-from-problem",
      message: `Le ${shift.date} n'est pas un jour ouvert de ce problème.`,
    }
  }
  if (shift.segments.length === 0) {
    return { reason: "split-shift-not-expressible", message: "Le shift ne porte aucun segment." }
  }
  if (shift.segments.length !== 1 && options.allowSplit !== true) {
    return {
      reason: "split-shift-not-expressible",
      message:
        "Les coupures ne sont pas énumérées par ce moteur : un shift à plusieurs segments ne peut pas être reproduit à l'identique.",
    }
  }
  return null
}

/** Whether the minutes a manager typed describe a legal shift at all. */
function describeGeometry(
  problem: PlanningProblemV3,
  shift: PlanningBaselineShiftV3,
  startMinutes: number,
  endMinutes: number,
  entryByKey: ReadonlyMap<string, PlanningProblemV3["employeeDays"][number]>
): Omit<PreservationIssue, "shiftId" | "kind"> | null {
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || endMinutes <= startMinutes) {
    return {
      reason: "geometry-inverted",
      message: `Horaires incohérents : ${startMinutes} → ${endMinutes}.`,
    }
  }

  const step = problem.timeStepMinutes
  if (startMinutes % step !== 0 || endMinutes % step !== 0) {
    return {
      reason: "geometry-not-on-time-step",
      message: `Horaires hors du pas de ${step} minutes : ${startMinutes} → ${endMinutes}.`,
    }
  }

  const duration = endMinutes - startMinutes
  const entry = entryByKey.get(`${String(shift.employeeId)}|${shift.date}`)
  if (entry === undefined || !entry.available) {
    return {
      reason: "employee-unavailable-that-day",
      message: `Le salarié ${String(shift.employeeId)} n'est pas disponible le ${shift.date}.`,
    }
  }
  if (startMinutes < entry.earliestStartMinutes || endMinutes > entry.latestEndMinutes) {
    return {
      reason: "geometry-outside-day-window",
      message: `Retouche hors de la plage autorisée [${entry.earliestStartMinutes}, ${entry.latestEndMinutes}].`,
    }
  }
  if (
    duration < problem.rules.minimumShiftMinutes ||
    duration > problem.rules.maximumShiftMinutes ||
    duration > entry.maximumMinutes
  ) {
    return {
      reason: "duration-outside-shift-bounds",
      message: `Durée de ${duration} minutes hors des bornes légales [${problem.rules.minimumShiftMinutes}, ${Math.min(problem.rules.maximumShiftMinutes, entry.maximumMinutes)}].`,
    }
  }
  return null
}
