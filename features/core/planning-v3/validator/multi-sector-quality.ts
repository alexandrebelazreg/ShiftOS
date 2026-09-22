import policy from "@/features/core/planning-v3/multi-sector-policy.json"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type { PlanningViolationV3 } from "@/features/core/planning-v3/types/validation"
import { normalizedSectorAssignments } from "./sector-assignment-invariants"

/** Independent audit: count actual coverage and roles, never solver columns. */
export function auditMultiSectorQuality(problem: PlanningProblemV3, solution: PlanningSolutionV3) {
  const step = problem.timeStepMinutes
  const targets = new Map<string, number>()
  const presence = new Map<string, Set<string>>()
  const priority = new Set<string>()
  const closed = new Map<string, Set<string>>()
  const sectors = new Map((problem.sectors ?? []).map((sector) => [sector.id, sector]))
  for (const sector of sectors.values()) for (const day of sector.days) {
    if (day.closed || day.opensAtMinutes == null || day.closesAtMinutes == null) continue
    for (let minute = day.opensAtMinutes; minute < Math.min(day.closesAtMinutes, day.opensAtMinutes + policy.openingPriorityMinutes); minute += step) {
      priority.add(`${sector.id}|${day.date}|${minute}`)
    }
  }
  for (const slot of problem.demandSlots) for (let minute = slot.startMinutes; minute < slot.endMinutes; minute += step) {
    const key = `${slot.sectorId ?? problem.sectorId}|${slot.date}|${minute}`
    targets.set(key, Math.max(targets.get(key) ?? 0, slot.requiredEmployees))
  }
  for (const assignment of solution.assignments) for (const block of normalizedSectorAssignments(problem, assignment)) {
    for (let minute = block.startMinutes; minute < block.endMinutes; minute += step) {
      const key = `${block.sectorId}|${assignment.date}|${minute}`
      const people = presence.get(key) ?? new Set<string>()
      people.add(String(assignment.employeeId)); presence.set(key, people)
    }
    const day = sectors.get(block.sectorId)?.days.find((entry) => entry.date === assignment.date)
    if (day?.closesAtMinutes != null && block.endMinutes >= day.closesAtMinutes && block.endMinutes <= (day.latestCloseMinutes ?? day.closesAtMinutes)) {
      const key = `${block.sectorId}|${assignment.employeeId}`
      const dates = closed.get(key) ?? new Set<string>()
      dates.add(assignment.date); closed.set(key, dates)
    }
  }
  let weightedCoverageCost = 0
  let unstaffedMinutes = 0
  for (const [key, target] of targets) {
    const count = presence.get(key)?.size ?? 0
    const missing = Math.max(0, target - count)
    const dark = target > 0 && count === 0
    const weight = policy.darkCounterWeight * (priority.has(key) ? policy.openingDarkMultiplier : 1)
    weightedCoverageCost += (missing + (dark ? weight - 1 : 0)) * step
    if (dark) unstaffedMinutes += step
  }
  const informations: PlanningViolationV3[] = []
  for (const sector of sectors.values()) {
    const fairness = sector.closingFairness
    if (!fairness?.balanceClosings && !fairness?.balanceSaturdayClosings) continue
    for (const employee of problem.employees) {
      if (!employee.canClose || !employee.allowedSectorIds?.includes(sector.id)) continue
      const dates = closed.get(`${sector.id}|${employee.id}`) ?? new Set<string>()
      const history = problem.closingHistory?.find((entry) => entry.sectorId === sector.id && entry.employeeId === employee.id)
      const saturday = [...dates].filter((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === 6).length
      for (const [enabled, rule, count, past] of [
        [fairness.balanceClosings, "closing-fairness", dates.size, history?.closings ?? 0],
        [fairness.balanceSaturdayClosings, "saturday-closing-fairness", saturday, history?.saturdayClosings ?? 0],
      ] as const) {
        if (enabled) informations.push({ rule, severity: "information", employeeId: employee.id,
          message: `${sector.name} — ${employee.firstName} : ${count} fermeture(s)${rule === "saturday-closing-fairness" ? " du samedi" : ""} cette semaine, ${past} dans l’historique.`, actual: count })
      }
    }
  }
  return { weightedCoverageCost, unstaffedMinutes, informations }
}
