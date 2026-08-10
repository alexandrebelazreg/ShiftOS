import type { PlanningEmployeeV3, PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type {
  PlanningAssignmentV3,
  PlanningSectorAssignmentV3,
  PlanningSegmentV3,
} from "@/features/core/planning-v3/types/solution"

export const MINIMUM_SECTOR_ASSIGNMENT_MINUTES = 60
export const MAXIMUM_SECTORS_PER_DAY = 2
export const MAXIMUM_SECTOR_SWITCHES_PER_DAY = 1

export interface SectorAssignmentIssue {
  readonly code:
    | "unknown-sector"
    | "unauthorized-sector"
    | "sector-off-step"
    | "sector-too-short"
    | "sector-gap-or-overlap"
    | "too-many-sectors"
    | "too-many-switches"
  readonly message: string
}

/** Ancienne solution mono-rayon → affectation couvrant chaque segment. */
export function normalizedSectorAssignments(
  problem: PlanningProblemV3,
  assignment: PlanningAssignmentV3
): readonly PlanningSectorAssignmentV3[] {
  if (assignment.sectorAssignments !== undefined) return assignment.sectorAssignments
  return assignment.segments.map((segment) => ({
    sectorId: problem.sectorId,
    startMinutes: segment.startMinutes,
    endMinutes: segment.endMinutes,
  }))
}

/**
 * Invariants partagés par le validateur, les adaptateurs et les tests.
 * Les pauses ne sont pas des changements de rayon : la séquence est lue sur
 * les seules minutes travaillées et les répétitions adjacentes sont écrasées.
 */
export function validateSectorAssignments(
  problem: PlanningProblemV3,
  employee: PlanningEmployeeV3,
  assignment: PlanningAssignmentV3
): readonly SectorAssignmentIssue[] {
  const issues: SectorAssignmentIssue[] = []
  const sectors = new Set((problem.sectors ?? [{ id: problem.sectorId }]).map((sector) => sector.id))
  const allowed = new Set(employee.allowedSectorIds ?? [problem.sectorId])
  const step = problem.timeStepMinutes
  const blocks = [...normalizedSectorAssignments(problem, assignment)].sort(
    (left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes
  )

  for (const block of blocks) {
    if (!sectors.has(block.sectorId)) {
      issues.push({ code: "unknown-sector", message: `Le rayon ${block.sectorId} n'appartient pas au problème.` })
    } else if (!allowed.has(block.sectorId)) {
      issues.push({ code: "unauthorized-sector", message: `${employee.firstName} n'est pas autorisé dans le rayon ${block.sectorId}.` })
    }
    if (block.startMinutes % step !== 0 || block.endMinutes % step !== 0) {
      issues.push({ code: "sector-off-step", message: `L'affectation ${block.sectorId} n'est pas alignée sur ${step} minutes.` })
    }
    if (block.endMinutes - block.startMinutes < MINIMUM_SECTOR_ASSIGNMENT_MINUTES) {
      issues.push({ code: "sector-too-short", message: `L'affectation ${block.sectorId} dure moins d'une heure.` })
    }
  }

  if (!coversExactly(assignment.segments, blocks)) {
    issues.push({ code: "sector-gap-or-overlap", message: "Les affectations par rayon doivent couvrir exactement le shift, sans trou ni chevauchement." })
  }

  const sequence = blocks.map((block) => block.sectorId).filter((id, index, values) => index === 0 || id !== values[index - 1])
  if (new Set(sequence).size > MAXIMUM_SECTORS_PER_DAY) {
    issues.push({ code: "too-many-sectors", message: "Un salarié ne peut travailler que dans deux rayons au maximum par jour." })
  }
  if (Math.max(0, sequence.length - 1) > MAXIMUM_SECTOR_SWITCHES_PER_DAY) {
    issues.push({ code: "too-many-switches", message: "Un seul changement de rayon est autorisé par jour (A → B → A est interdit)." })
  }
  return issues
}

function coversExactly(
  segments: readonly PlanningSegmentV3[],
  blocks: readonly PlanningSectorAssignmentV3[]
): boolean {
  const events = new Set<number>()
  for (const segment of segments) { events.add(segment.startMinutes); events.add(segment.endMinutes) }
  for (const block of blocks) { events.add(block.startMinutes); events.add(block.endMinutes) }
  const points = [...events].sort((a, b) => a - b)
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index]
    const end = points[index + 1]
    if (end <= start) continue
    const worked = segments.some((segment) => segment.startMinutes <= start && segment.endMinutes >= end)
    const assigned = blocks.filter((block) => block.startMinutes <= start && block.endMinutes >= end).length
    if ((worked && assigned !== 1) || (!worked && assigned !== 0)) return false
  }
  return true
}
