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
  for (const employee of [...problem.employees].sort(byId)) {
    parts.push(
      `E|${String(employee.id)}|${employee.contractMinutes}|${employee.workingDays.join(".")}|${employee.fixedRestDays.join(".")}|${employee.canOpen ? 1 : 0}${employee.canClose ? 1 : 0}|${employee.maximumOpenings ?? "-"}|${employee.maximumClosings ?? "-"}`
    )
  }
  for (const day of [...problem.days].sort((left, right) => left.date.localeCompare(right.date))) {
    parts.push(
      `D|${day.date}|${day.closed ? 1 : 0}|${day.opensAtMinutes ?? "-"}|${day.closesAtMinutes ?? "-"}|${day.budgetMinutes}`
    )
  }
  for (const slot of [...problem.demandSlots].sort(bySlot)) {
    parts.push(`S|${slot.id}|${slot.date}|${slot.startMinutes}|${slot.endMinutes}|${slot.requiredEmployees}`)
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
          .join(",")}`
    )
    .sort()
  return `s3_${hash64([solution.version, solution.problemFingerprint, ...rows].join("\n"))}`
}

function byId(left: { id: unknown }, right: { id: unknown }): number {
  return String(left.id).localeCompare(String(right.id))
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
