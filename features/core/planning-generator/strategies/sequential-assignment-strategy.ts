import type { Assignment, EmployeeId, Shift } from "@/features/core/models"
import { intervalMinutes } from "@/features/core/shared"

import type {
  AssignmentRanking,
  GenerationContext,
  GenerationPlan,
  GenerationStrategy,
} from "@/features/core/planning-generator/types"
import { buildAssignment, buildShiftForRequirement } from "@/features/core/planning-generator/builders"
import { isAdmissibleAddition } from "@/features/core/planning-generator/validators"
import { inChronologicalOrder } from "@/features/core/planning-generator/utils"
import {
  DEFAULT_RANKING_DIMENSIONS,
  computeFairnessLoad,
  rankCandidates,
  type RankingContext,
} from "@/features/core/planning-generator/ranking"

/**
 * SequentialAssignmentStrategy — a one-pass, deterministic fill that RANKS every
 * compatible employee and assigns the best candidate.
 *
 * For each coverage requirement, in chronological order, and for each slot up to
 * the minimum:
 *   1. build the shift that hosts the window;
 *   2. take the active employees not already on the shift;
 *   3. keep only those a hard constraint admits (availability, contract, …) —
 *      the compatibility GATE, so incompatible employees never rank;
 *   4. RANK the compatible employees (contract balance + fairness + current
 *      workload) and assign the highest-ranked one;
 *   5. record WHY it was chosen (breakdown + the alternatives) for explainability.
 *
 * It is not optimization, search, AI or backtracking: a single greedy pass. All
 * rule knowledge stays in the injected constraint registry and the reused
 * engines; the ranking dimensions hold no business rule. Deterministic — ties
 * break by employee id.
 */
export const sequentialAssignmentStrategy: GenerationStrategy = {
  name: "sequential-assignment",

  generate(context: GenerationContext): GenerationPlan {
    const { demand, store, settings, evaluator, registry, planning } = context
    const activeEmployees = context.employees.filter((e) => e.status === "active")
    const employeeById = new Map<EmployeeId, (typeof activeEmployees)[number]>(
      activeEmployees.map((e) => [e.id, e])
    )
    const contractByEmployee = new Map(context.contracts.map((c) => [c.employeeId, c]))
    const orderedRequirements = inChronologicalOrder(demand.requirements)

    const shifts: Shift[] = []
    const assignments: Assignment[] = []
    const assignmentRankings: AssignmentRanking[] = []
    // Live, incrementally-updated workload for THIS generation.
    const assignedMinutes = new Map<EmployeeId, number>()
    let candidatesRejectedByHardConstraints = 0
    let constraintEvaluations = 0

    for (const requirement of orderedRequirements) {
      const shift = buildShiftForRequirement(requirement, store, settings)
      const shiftsInPlay = [...shifts, shift]
      const shiftMinutes = durationOf(shift)

      const min = requirement.minEmployees
      const max = requirement.maxEmployees ?? Number.POSITIVE_INFINITY
      const assignedToShift = new Set<EmployeeId>()

      // Fairness debt is the costly signal → compute once per requirement,
      // reusing the Statistics + Fairness engines (no duplicated calculation).
      const fairnessLoadByEmployee = computeFairnessLoad(context, assignments, shiftsInPlay)

      while (assignedToShift.size < min && assignedToShift.size < max) {
        // Compatibility gate: the compatible pool for this slot.
        const compatible = activeEmployees.filter((employee) => {
          if (assignedToShift.has(employee.id)) return false
          const candidate = buildAssignment(planning, shift, employee, settings)
          const admissible = isAdmissibleAddition(
            evaluator,
            registry,
            context,
            shiftsInPlay,
            assignments,
            candidate
          )
          constraintEvaluations += 1
          if (!admissible) candidatesRejectedByHardConstraints += 1
          return admissible
        })

        if (compatible.length === 0) break

        // Candidate ranking → best candidate.
        const rankingContext: RankingContext = {
          assignedMinutesByEmployee: assignedMinutes,
          maxAssignedMinutes: maxValue(assignedMinutes),
          contractByEmployee,
          fairnessLoadByEmployee,
          shiftMinutes,
        }
        const ranked = rankCandidates(compatible, rankingContext, DEFAULT_RANKING_DIMENSIONS)
        const best = ranked[0]
        const employee = employeeById.get(best.employeeId)!

        const assignment = buildAssignment(planning, shift, employee, settings)
        assignments.push(assignment)
        assignedToShift.add(employee.id)
        assignedMinutes.set(employee.id, (assignedMinutes.get(employee.id) ?? 0) + shiftMinutes)

        assignmentRankings.push({
          assignmentId: assignment.id,
          requirementId: requirement.id,
          shiftId: shift.id,
          selected: best,
          alternatives: ranked.slice(1),
        })
      }

      if (assignedToShift.size > 0) shifts.push(shift)
    }

    return {
      shifts,
      assignments,
      candidatesRejectedByHardConstraints,
      constraintEvaluations,
      assignmentRankings,
    }
  },
}

/** Total worked minutes of a shift (sum of its segments). */
function durationOf(shift: Shift): number {
  return shift.segments.reduce(
    (sum, s) => sum + (intervalMinutes(s.startTime, s.endTime, s.endDayOffset) ?? 0),
    0
  )
}

function maxValue(map: ReadonlyMap<EmployeeId, number>): number {
  let max = 0
  for (const value of map.values()) if (value > max) max = value
  return max
}
