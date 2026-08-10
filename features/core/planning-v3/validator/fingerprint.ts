import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"

/**
 * Deterministic fingerprints for V3 problems and solutions.
 *
 * The point is comparability, not secrecy: two runs that produce the same
 * schedule must produce the same string, and any difference in the assignments
 * must change it.
 *
 * Two independently seeded 32-bit FNV-1a passes are concatenated into a 64-bit
 * hex digest. `Math.imul` keeps the multiply in 32-bit integer space, so the
 * result is exact, synchronous and free of any BigInt or crypto dependency.
 */

const FNV_PRIME_32 = 0x01000193

function hash32(value: string, seed: number): number {
  let digest = seed
  for (let index = 0; index < value.length; index++) {
    digest = Math.imul(digest ^ value.charCodeAt(index), FNV_PRIME_32)
  }
  return digest >>> 0
}

function hash64(value: string): string {
  const low = hash32(value, 0x811c9dc5)
  const high = hash32(value, 0x9e3779b9)
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0")
}

/** Canonical, order-stable text for a problem. */
export function fingerprintProblem(problem: PlanningProblemV3): string {
  const parts: string[] = [
    problem.version,
    String(problem.planningId),
    problem.sectorId,
    `${problem.period.start}..${problem.period.end}`,
    `step=${problem.timeStepMinutes}`,
    `rules=${JSON.stringify(problem.rules)}`,
    `objectives=${problem.objectives.join(",")}`,
  ]
  if (problem.sectors !== undefined) parts.push(`sectors=${JSON.stringify(problem.sectors)}`)
  for (const employee of [...problem.employees].sort(byId)) {
    // The daily bounds and the right to split belong here as much as the
    // contract does: they decide what a day may hold, so two rosters that
    // differ on them pose different questions. Only the display name is left
    // out — it changes nothing a solver can act on.
    parts.push(
      `E|${String(employee.id)}|${employee.contractMinutes}|${employee.workingDays.join(".")}|${employee.fixedRestDays.join(".")}|${employee.minimumDailyMinutes}|${employee.maximumDailyMinutes}|${employee.canOpen ? 1 : 0}${employee.canClose ? 1 : 0}${employee.canSplitShift ? 1 : 0}|${employee.maximumOpenings ?? "-"}|${employee.maximumClosings ?? "-"}${employee.allowedSectorIds === undefined ? "" : `|${employee.allowedSectorIds.join(".")}`}`
    )
  }
  for (const day of [...problem.days].sort((left, right) => left.date.localeCompare(right.date))) {
    parts.push(
      `D|${day.date}|${day.closed ? 1 : 0}|${day.opensAtMinutes ?? "-"}|${day.closesAtMinutes ?? "-"}|${day.budgetMinutes}${day.budgetMode === undefined ? "" : `|${day.budgetMode}`}`
    )
  }
  // Per-person, per-day availability — the field this function was blind to for
  // longest, and the most costly one to be blind to.
  //
  // A week where someone is AWAY and the same week where they are there shared
  // one identity. So did two weeks differing only in when a person may first
  // arrive, or how late they may stay. A perturbation campaign built on this
  // fingerprint silently lost three of its six axes: every scenario looked like
  // the baseline and was discarded as a duplicate.
  //
  // Nothing downstream can recover from that. A cached result, a comparison
  // between engines, a regression pinned to a fingerprint — each would be
  // answering about a different roster than the one asked about, and would look
  // right while doing it.
  for (const entry of [...problem.employeeDays].sort(byEmployeeDay)) {
    parts.push(
      `A|${String(entry.employeeId)}|${entry.date}|${entry.available ? 1 : 0}${entry.mandatory ? 1 : 0}${entry.fixedRest ? 1 : 0}|${entry.earliestStartMinutes}|${entry.latestEndMinutes}|${entry.maximumMinutes}`
    )
  }
  // Closing history — hashed ONLY when a balance is on, which is exactly when
  // it can change an answer. Hashing it unconditionally would give a new
  // identity to every week whose history moved, invalidating stored results for
  // problems that would still be solved identically.
  //
  // `rules` already carries the policy and is hashed whole, so switching a
  // balance on moves the digest on its own; this block adds the numbers the
  // engines will actually read.
  for (const entry of [...(problem.closingHistory ?? [])].sort(byEmployeeId)) {
    parts.push(
      `H${entry.sectorId === undefined ? "" : `|${entry.sectorId}`}|${String(entry.employeeId)}|${entry.closings}|${entry.opportunities}|${entry.saturdayClosings}|${entry.saturdayOpportunities}`
    )
  }
  for (const slot of [...problem.demandSlots].sort(bySlot)) {
    // The head-count fields are ALL of them, including the ones that may be
    // absent. A fingerprint blind to `hardMinimumEmployees` gave the same
    // identity to a week that must never be left unattended and a week where
    // the same shortfall is a degradation to accept — two different questions
    // wearing one name, which is the single thing this function exists to stop.
    // Absent is written as `-` rather than skipped, so "not declared" and
    // "declared zero" stay distinguishable.
    parts.push(
      `S|${slot.id}${slot.sectorId === undefined ? "" : `|${slot.sectorId}`}|${slot.date}|${slot.startMinutes}|${slot.endMinutes}|${slot.requiredEmployees}|${slot.hardMinimumEmployees ?? "-"}|${slot.maximumEmployees ?? "-"}`
    )
  }
  return `p3_${hash64(parts.join("\n"))}`
}

/** Canonical, order-stable text for a solution. */
export function fingerprintSolution(solution: PlanningSolutionV3): string {
  const rows = solution.assignments
    .map(
      (assignment) =>
        `${String(assignment.employeeId)}|${assignment.date}|${[...assignment.segments]
          .sort((left, right) => left.startMinutes - right.startMinutes)
          .map((segment) => `${segment.startMinutes}-${segment.endMinutes}`)
          .join(",")}${assignment.sectorAssignments === undefined ? "" : `|${[...assignment.sectorAssignments]
            .sort((left, right) => left.startMinutes - right.startMinutes)
            .map((block) => `${block.sectorId}:${block.startMinutes}-${block.endMinutes}`)
            .join(",")}`}`
    )
    .sort()
  return `s3_${hash64([solution.version, solution.problemFingerprint, ...rows].join("\n"))}`
}

function byId(left: { id: unknown }, right: { id: unknown }): number {
  return String(left.id).localeCompare(String(right.id))
}

function byEmployeeId(left: { employeeId: unknown }, right: { employeeId: unknown }): number {
  return String(left.employeeId).localeCompare(String(right.employeeId))
}

function byEmployeeDay(
  left: { employeeId: unknown; date: string },
  right: { employeeId: unknown; date: string }
): number {
  return (
    String(left.employeeId).localeCompare(String(right.employeeId)) ||
    left.date.localeCompare(right.date)
  )
}

function bySlot(
  left: { date: string; startMinutes: number; id: string },
  right: { date: string; startMinutes: number; id: string }
): number {
  return (
    left.date.localeCompare(right.date) ||
    left.startMinutes - right.startMinutes ||
    left.id.localeCompare(right.id)
  )
}
