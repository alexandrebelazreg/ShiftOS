import type {
  Assignment,
  CapabilityKey,
  Employee,
  EmployeeId,
  Shift,
} from "@/features/core/models"

import type {
  Coverage,
  CoverageGap,
  CoverageRequirement,
  CoverageResult,
  CoverageStatistics,
  Demand,
} from "@/features/core/demand-engine/models"
import type { CoverageStatus } from "@/features/core/demand-engine/types"
import { minimumConcurrentPresence, timeToMinutes } from "@/features/core/shared"

/** Everything the coverage calculation compares. */
export interface CoverageInput {
  readonly demand: Demand
  readonly assignments: readonly Assignment[]
  readonly shifts: readonly Shift[]
  readonly employees: readonly Employee[]
}

/**
 * CoverageCalculator — compares a Demand against Assignments and reports, per
 * requirement, whether it is covered / under-covered / over-covered, which
 * capabilities are missing and how much of the minimum is met. Pure,
 * deterministic and independent (no scheduling, optimization or generation).
 */
export interface CoverageCalculator {
  calculate(input: CoverageInput): Coverage
}

function coverageStatus(
  assignedCount: number,
  min: number,
  max: number | null
): CoverageStatus {
  if (assignedCount < min) return "under_covered"
  if (max !== null && assignedCount > max) return "over_covered"
  return "covered"
}

export const coverageCalculator: CoverageCalculator = {
  calculate({ demand, assignments, shifts, employees }: CoverageInput): Coverage {
    const shiftById = new Map<Shift["id"], Shift>(
      shifts.map((shift) => [shift.id, shift])
    )
    const capabilitiesByEmployee = new Map<EmployeeId, ReadonlySet<CapabilityKey>>(
      employees.map((e) => [e.id, new Set(e.capabilities)])
    )

    const results: CoverageResult[] = []
    const gaps: CoverageGap[] = []

    for (const requirement of demand.requirements) {
      const operationalCoverage = collectOperationalCoverage(
        requirement,
        assignments,
        shiftById
      )
      const coveringEmployees = operationalCoverage.coveringEmployees
      // The headcount compared against the requirement is the WORST moment of
      // the window, not the count of employees who each individually span all
      // of it — see `collectOperationalCoverage`.
      const assignedCount = operationalCoverage.minimumConcurrentPresent
      const min = requirement.minEmployees
      const max = requirement.maxEmployees ?? null

      const missingCapabilities = missingCapabilitiesFor(
        requirement.requiredCapabilities ?? [],
        coveringEmployees,
        capabilitiesByEmployee
      )

      const status = coverageStatus(assignedCount, min, max)
      const coveragePercentage = min > 0 ? Math.min(assignedCount / min, 1) : 1

      results.push({
        requirementId: requirement.id,
        window: requirement.window,
        status,
        requiredMin: min,
        requiredMax: max,
        assignedCount,
        coveragePercentage,
        missingCapabilities,
        coveringEmployees,
        partiallyCoveringEmployees: operationalCoverage.partiallyCoveringEmployees,
        coveredEmployeeMinutes: operationalCoverage.coveredEmployeeMinutes,
        partialCoverageMinutes: operationalCoverage.partialCoverageMinutes,
      })

      const missingEmployees = Math.max(0, min - assignedCount)
      if (missingEmployees > 0 || missingCapabilities.length > 0) {
        gaps.push({
          requirementId: requirement.id,
          window: requirement.window,
          missingEmployees,
          missingCapabilities,
        })
      }
    }

    return { demandId: demand.id, results, gaps, statistics: summarize(results) }
  },
}

/**
 * Complete head-count, separately exposed partial employee-minutes, and the
 * TRUE minimum concurrent presence across the window.
 *
 * `coveringEmployees` / `partiallyCoveringEmployees` still classify each
 * employee by whether THEIR OWN merged presence spans the whole window —
 * unchanged, because capability adequacy is a different question this fix
 * does not touch. `minimumConcurrentPresent` is the number that answers the
 * one this file exists for: how many people, at the thinnest moment, are
 * actually on the floor. Two or three staggered employees can keep that
 * number at or above the requirement throughout the window without any one of
 * them individually spanning it — which is exactly the case the per-employee
 * "complete" flag was blind to.
 */
function collectOperationalCoverage(
  requirement: CoverageRequirement,
  assignments: readonly Assignment[],
  shiftById: ReadonlyMap<Shift["id"], Shift>
): {
  coveringEmployees: EmployeeId[]
  partiallyCoveringEmployees: EmployeeId[]
  coveredEmployeeMinutes: number
  partialCoverageMinutes: number
  minimumConcurrentPresent: number
} {
  const { window } = requirement
  const byEmployee = new Map<EmployeeId, Array<readonly [number, number]>>()
  const windowStart = timeToMinutes(window.start), rawWindowEnd = timeToMinutes(window.end)
  if (windowStart === null || rawWindowEnd === null) {
    return {
      coveringEmployees: [],
      partiallyCoveringEmployees: [],
      coveredEmployeeMinutes: 0,
      partialCoverageMinutes: 0,
      minimumConcurrentPresent: 0,
    }
  }
  const windowEnd = rawWindowEnd + (window.endDayOffset ?? 0) * 24 * 60

  for (const assignment of assignments) {
    const shift = shiftById.get(assignment.shiftId)
    if (!shift || shift.date !== window.date) continue
    for (const segment of shift.segments) {
      const segmentStart = timeToMinutes(segment.startTime), rawSegmentEnd = timeToMinutes(segment.endTime)
      if (segmentStart === null || rawSegmentEnd === null) continue
      const segmentEnd = rawSegmentEnd + (segment.endDayOffset ?? 0) * 24 * 60
      const start = Math.max(windowStart, segmentStart), end = Math.min(windowEnd, segmentEnd)
      if (start < end) byEmployee.set(assignment.employeeId, [...(byEmployee.get(assignment.employeeId) ?? []), [start, end]])
    }
  }
  const coveringEmployees: EmployeeId[] = [], partiallyCoveringEmployees: EmployeeId[] = []
  const allMergedIntervals: Array<{ startMinutes: number; endMinutes: number }> = []
  let coveredEmployeeMinutes = 0, partialCoverageMinutes = 0
  for (const [employeeId, intervals] of [...byEmployee].sort(([left], [right]) => String(left).localeCompare(String(right)))) {
    const merged: Array<[number, number]> = []
    for (const [start, end] of intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
      const last = merged.at(-1)
      if (last && start <= last[1]) last[1] = Math.max(last[1], end)
      else merged.push([start, end])
    }
    // Each of this employee's own merged intervals is disjoint from the
    // others by construction, so pushing them all as separate entries never
    // double-counts one employee inside a single atomic piece.
    for (const [start, end] of merged) allMergedIntervals.push({ startMinutes: start, endMinutes: end })
    const minutes = merged.reduce((sum, [start, end]) => sum + end - start, 0)
    coveredEmployeeMinutes += minutes
    const complete = merged.length === 1 && merged[0][0] <= windowStart && merged[0][1] >= windowEnd
    if (complete) coveringEmployees.push(employeeId)
    else { partiallyCoveringEmployees.push(employeeId); partialCoverageMinutes += minutes }
  }
  const minimumConcurrentPresent = minimumConcurrentPresence(
    { startMinutes: windowStart, endMinutes: windowEnd },
    allMergedIntervals
  )
  return {
    coveringEmployees,
    partiallyCoveringEmployees,
    coveredEmployeeMinutes,
    partialCoverageMinutes,
    minimumConcurrentPresent,
  }
}

/** Required capabilities held by no covering employee. */
function missingCapabilitiesFor(
  required: readonly CapabilityKey[],
  coveringEmployees: readonly EmployeeId[],
  capabilitiesByEmployee: ReadonlyMap<EmployeeId, ReadonlySet<CapabilityKey>>
): CapabilityKey[] {
  return required.filter(
    (capability) =>
      !coveringEmployees.some((employeeId) =>
        capabilitiesByEmployee.get(employeeId)?.has(capability)
      )
  )
}

function summarize(results: readonly CoverageResult[]): CoverageStatistics {
  let covered = 0
  let underCovered = 0
  let overCovered = 0
  let requirementsWithMissingCapabilities = 0
  let totalRequiredMin = 0
  let totalAssigned = 0

  for (const result of results) {
    if (result.status === "covered") covered += 1
    else if (result.status === "under_covered") underCovered += 1
    else overCovered += 1

    if (result.missingCapabilities.length > 0) {
      requirementsWithMissingCapabilities += 1
    }
    totalRequiredMin += result.requiredMin
    totalAssigned += result.assignedCount
  }

  const total = results.length
  return {
    totalRequirements: total,
    covered,
    underCovered,
    overCovered,
    requirementsWithMissingCapabilities,
    totalRequiredMin,
    totalAssigned,
    overallCoveragePercentage: total > 0 ? covered / total : 1,
  }
}
