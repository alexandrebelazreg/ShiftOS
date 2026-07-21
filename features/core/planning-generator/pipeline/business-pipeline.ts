import { contractualMinutes, type Assignment, type Employee, type EmployeeId, type Shift, type ShiftId, type TimeString } from "@/features/core/models"
import { intervalMinutes, timeToMinutes, weekDayOf } from "@/features/core/shared"
import type { CoverageRequirement } from "@/features/core/demand-engine"
import { availabilityCalculator } from "@/features/core/employee-engine"
import { buildAssignment, buildEmployeeShiftForRequirement, buildShiftForRequirement } from "@/features/core/planning-generator/builders"
import { isAdmissibleAddition, validateCandidatePlan } from "@/features/core/planning-generator/validators"
import { inChronologicalOrder } from "@/features/core/planning-generator/utils"
import { allocateDailyContractMinutes } from "@/features/core/planning-generator/pipeline/weekly-distribution"
import { allocateWeeklyMinutes, type WeeklyMinuteAllocation } from "@/features/core/planning-generator/pipeline/weekly-minute-allocator"
import type { AssignmentRanking, GenerationContext, GenerationPlan, PlanningExplanation, PlanningIssue, PlanningIssueSeverity, PipelinePhaseName, RankedCandidate, RepairAttemptStatistics } from "@/features/core/planning-generator/types"

interface MutableRepairStatistics { family: string; generated: number; rejected: number; evaluated: number; accepted: number }

export interface PipelineState {
  readonly context: GenerationContext
  requirements: readonly CoverageRequirement[]
  shifts: Shift[]
  assignments: Assignment[]
  rankings: AssignmentRanking[]
  explanations: PlanningExplanation[]
  issues: PlanningIssue[]
  trace: PipelinePhaseName[]
  rejected: number
  evaluations: number
  closingCounts: Map<EmployeeId, number>
  repairAttempts: Map<string, MutableRepairStatistics>
  allocation: WeeklyMinuteAllocation | null
}

export interface PlanningPipelinePhase { readonly name: PipelinePhaseName; run(state: PipelineState): void }

const validationPhase: PlanningPipelinePhase = { name: "validation", run(state) {
  const { context } = state
  if (!context.store.name.trim()) issue(state, "store_missing", "blocking", this.name, "Le magasin doit être configuré.")
  if (context.demand.requirements.length === 0) issue(state, "coverage_missing", "blocking", this.name, "Aucun profil de couverture n’est configuré.")
  if (!context.employees.some((employee) => employee.status === "active")) issue(state, "employees_missing", "blocking", this.name, "Aucun salarié actif n’est disponible.")
  for (const employee of context.employees.filter((item) => item.status === "active")) {
    if (!context.contracts.some((contract) => contract.employeeId === employee.id)) issue(state, "contract_missing", "blocking", this.name, `Aucun contrat n’est configuré pour ${employee.firstName}.`, undefined, employee.id)
  }
  for (const requirement of context.demand.requirements) {
    if (requirement.minEmployees < 0 || !Number.isInteger(requirement.minEmployees)) issue(state, "coverage_invalid", "blocking", this.name, `Le besoin ${requirement.id} est invalide.`, requirement)
    if (requirement.requiredCapabilities?.length && !context.employees.some((employee) => requirement.requiredCapabilities!.every((key) => employee.capabilities.includes(key)))) issue(state, "competency_missing", "blocking", this.name, `Aucun salarié ne possède toutes les compétences requises pour ${requirement.id}.`, requirement)
  }
  for (const sector of context.business.sectors ?? []) {
    if (!sector.active) continue
    const total = Object.values(sector.weeklyDistribution).reduce((sum, value) => sum + value, 0)
    if (total !== 100) issue(state, "weekly_distribution_invalid", "blocking", this.name, `La répartition du secteur « ${sector.name} » doit totaliser 100 %.`)
    if (sector.minimumShiftDuration <= 0 || sector.minimumShiftDuration % 15 !== 0) issue(state, "minimum_shift_invalid", "blocking", this.name, `La durée minimale du secteur « ${sector.name} » est invalide.`)
    if (sector.assignedEmployeeIds.length === 0) issue(state, "sector_unstaffed", "blocking", this.name, `Aucun salarié n’est affecté au secteur « ${sector.name} ».`)
    if (sector.requirementIds.length === 0) issue(state, "sector_coverage_missing", "blocking", this.name, `Le secteur « ${sector.name} » n’a aucun profil de couverture.`)
    const employeeIds = new Set(sector.assignedEmployeeIds), totalMinutes = activeEmployees(state).filter((employee) => employeeIds.has(employee.id)).reduce((sum, employee) => { const contract = context.contracts.find((item) => item.employeeId === employee.id); return sum + (contract ? contractualMinutes(contract) : 0) }, 0), increment = context.settings.timeIncrementMinutes ?? 15
    if (totalMinutes % increment !== 0) issue(state, "sector_contract_increment_incompatible", "blocking", this.name, `Le total contractuel du secteur « ${sector.name} » (${totalMinutes} minutes) ne peut pas être réparti exactement par pas de ${increment} minutes.`)
  }
  const activeSectors = (context.business.sectors ?? []).filter((sector) => sector.active)
  for (const employee of activeEmployees(state)) {
    const memberships = activeSectors.filter((sector) => sector.assignedEmployeeIds.includes(employee.id))
    if (memberships.length > 1) issue(state, "multi_sector_contract_allocation_missing", "blocking", this.name, `${employee.firstName} appartient à plusieurs secteurs actifs (${memberships.map((sector) => sector.name).join(", ")}) sans allocation contractuelle explicite.`, undefined, employee.id)
  }
} }

const demandCalculationPhase: PlanningPipelinePhase = { name: "demand-calculation", run(state) {
  state.requirements = inChronologicalOrder(state.context.demand.requirements)
  state.shifts = state.requirements.map((requirement) => coherentShiftForRequirement(state, requirement))
  const targets = (state.context.business.sectors ?? []).flatMap((sector) => Object.entries(sector.weeklyDistribution).map(([day, percentage]) => `${day}: ${percentage}%`))
  state.explanations.push({ phase: this.name, message: `${state.requirements.length} plage(s) de demande calculée(s), sans affectation.`, reasons: targets })
} }

const weeklyAllocationPhase: PlanningPipelinePhase = { name: "weekly-allocation", run(state) {
  // V2 remains available only through an explicit compatibility opt-in. The
  // application never sets this mode, so it cannot be selected silently.
  if (state.context.business.pipelineMode === "legacy-v2") return
  const sectors = (state.context.business.sectors ?? []).filter((sector) => sector.active)
  if (!sectors.length) { issue(state, "weekly_allocation_requires_active_sector", "blocking", this.name, "L'allocation hebdomadaire nécessite un secteur actif. La génération V2 de secours est désactivée."); return }
  if (sectors.length !== 1) { issue(state, "weekly_allocation_requires_single_sector", "blocking", this.name, "L’allocation hebdomadaire verrouillée nécessite un unique secteur actif pour cette version alpha."); return }
  const sector = sectors[0], periodDates = dates(state.context.settings.period.start, state.context.settings.period.end), availabilityByEmployeeDate = new Map<string, { maximumContinuousMinutes: number; reason?: string }>()
  for (const employee of state.context.employees) {
    const contract = state.context.contracts.find((item) => item.employeeId === employee.id) ?? null
    const availability = availabilityCalculator.calculate({ employeeId: employee.id, period: state.context.settings.period, store: state.context.store, contract, constraints: state.context.employeeConstraints, availabilityRules: state.context.availabilityRules, absences: state.context.absences, holidays: state.context.holidays })
    for (const date of periodDates) {
      const day = availability.days.find((item) => item.date === date), sectorHours = sector.hours?.find((item) => item.day === weekDayOf(date))
      const maximumContinuousMinutes = day?.status === "available" ? day.windows.reduce((maximum, window) => { const start = Math.max(timeToMinutes(window.start)!, sectorHours && !sectorHours.closed ? timeToMinutes(sectorHours.opensAt as TimeString)! : 0), end = Math.min(timeToMinutes(window.end)!, sectorHours && !sectorHours.closed ? timeToMinutes(sectorHours.closesAt as TimeString)! : 24 * 60); return Math.max(maximum, Math.max(0, end - start)) }, 0) : 0
      availabilityByEmployeeDate.set(`${employee.id}|${date}`, { maximumContinuousMinutes, reason: day?.unavailableReason })
    }
  }
  const allocation = allocateWeeklyMinutes({ employees: state.context.employees, contracts: state.context.contracts, dates: periodDates, store: state.context.store, sector, settings: state.context.settings, requirements: state.requirements, availabilityByEmployeeDate })
  state.allocation = allocation
  for (const message of allocation.errors) issue(state, "weekly_allocation_impossible", "blocking", this.name, message)
  if (allocation.errors.length) return
  state.explanations.push({ phase: this.name, message: allocation.exactDailyBudgets ? "La matrice salarié × jour respecte exactement les contrats et les budgets journaliers." : "Les contrats sont exacts mais certains budgets journaliers sont mathématiquement inatteignables.", reasons: allocation.dailyTotals.map((day) => `${day.date} : ${day.allocatedMinutes} / ${day.targetMinutes} minutes (${formatSignedMinutes(day.differenceMinutes)})`) })
} }

const dailyPlacementPhase: PlanningPipelinePhase = { name: "daily-placement", run(state) {
  if (!state.allocation || state.allocation.errors.length) return
  placeAllocatedWeek(state)
} }

const closingAssignmentPhase: PlanningPipelinePhase = { name: "closing-assignment", run(state) {
  if (state.allocation) return
  for (const requirement of state.requirements.filter((item) => isClosing(state.context, item))) fillRequirement(state, requirement, this.name, true)
} }

const legalRestPhase: PlanningPipelinePhase = { name: "legal-rest", run(state) {
  if (state.allocation) return
  const rest = state.context.settings.minimumRestMinutes ?? 720
  const violations = validateCandidatePlan(state.context, state.requirements, state.shifts, state.assignments).filter((item) => item.code === "minimum_rest")
  state.explanations.push({ phase: this.name, message: `${violations.length} incompatibilité(s) de repos détectée(s) dans le planning candidat complet.`, reasons: [`Repos minimal : ${rest} minutes`, "Le repos sera recalculé après chaque mutation"] })
} }

const openingAssignmentPhase: PlanningPipelinePhase = { name: "opening-assignment", run(state) {
  if (state.allocation) return
  for (const requirement of state.requirements.filter((item) => isOpening(state.context, item))) fillRequirement(state, requirement, this.name, false)
} }

const coveragePhase: PlanningPipelinePhase = { name: "coverage", run(state) {
  if (state.allocation) return
  for (const requirement of state.requirements) {
    fillRequirement(state, requirement, this.name, false)
  }
} }

const contractCompletionPhase: PlanningPipelinePhase = { name: "contract-completion", run(state) {
  if (state.allocation) return
  mergeEmployeeDayShifts(state, 15)
  const increment = state.context.settings.timeIncrementMinutes ?? 15
  const maximum = state.context.settings.maximumDailyMinutes ?? 600
  for (const employee of activeEmployees(state)) {
    const contract = state.context.contracts.find((item) => item.employeeId === employee.id)
    if (!contract) continue
    let remaining = contractualMinutes(contract) - assignedMinutes(state, employee.id)
    if (remaining <= 0) continue
    const workDates = dates(state.context.settings.period.start, state.context.settings.period.end).filter((date) => contract.workingDays.includes(weekDayOf(date)))
    const missingDates = workDates.filter((date) => !state.assignments.some((assignment) => assignment.employeeId === employee.id && shiftFor(state, assignment.shiftId)?.date === date))
    const minimum = minimumShiftFor(state, employee.id)
    const extensionBudget = Math.max(0, remaining - missingDates.length * minimum)
    const extensionRemainder = extendExistingShifts(state, employee, extensionBudget, increment, maximum)
    remaining -= extensionBudget - extensionRemainder
    for (const date of workDates) {
      if (remaining <= 0) break
      if (!contract.workingDays.includes(weekDayOf(date))) continue
      const reusableRequirement = state.requirements.find((requirement) => {
        const template = shiftForRequirement(state, requirement), duration = shiftDuration(template)
        return requirement.window.date === date && !assignedFor(state, requirement).some((assignment) => assignment.employeeId === employee.id) && assignedFor(state, requirement).length < (requirement.maxEmployees ?? Infinity) && duration <= remaining
      })
      if (reusableRequirement) {
        const reusable = buildEmployeeShiftForRequirement(shiftForRequirement(state, reusableRequirement), reusableRequirement, employee.id)
        const candidate = buildAssignment(state.context.planning, reusable, employee, state.context.settings)
        if (candidateAllowed(state, employee, reusable, candidate, reusableRequirement, false)) {
          const duration = shiftDuration(reusable)
          state.shifts.push(reusable); state.assignments.push(candidate); remaining -= duration
          explain(state, this.name, candidate, reusableRequirement, ["Shift individuel créé depuis une demande sous-couverte", `Complétion de ${duration} minutes de contrat`])
          continue
        }
      }
      const day = storeDay(state.context, date)
      if (!day || day.closed || !day.opensAt || !day.closesAt) continue
      const mustCreateWorkday = missingDates.includes(date)
      if (!mustCreateWorkday && state.assignments.some((assignment) => assignment.employeeId === employee.id && shiftFor(state, assignment.shiftId)?.date === date)) continue
      if (mustCreateWorkday && remaining < minimum) continue
      const available = Math.min(maximum, timeToMinutes(day.closesAt)! - timeToMinutes(day.opensAt)!, mustCreateWorkday ? minimum : remaining)
      const duration = Math.floor(available / increment) * increment
      if (duration <= 0) continue
      const shift = syntheticShift(state, employee.id, date, day.opensAt, duration)
      const candidate = buildAssignment(state.context.planning, shift, employee, state.context.settings)
      if (!candidateAllowed(state, employee, shift, candidate, undefined, false)) continue
      state.shifts.push(shift); state.assignments.push(candidate); remaining -= duration
      explain(state, this.name, candidate, undefined, ["Créneau créé après extension des shifts existants", `Complétion de ${duration} minutes de contrat`])
    }
    remaining = extendExistingShifts(state, employee, remaining, increment, maximum)
  }
} }

const globalWeeklyRepairPhase: PlanningPipelinePhase = { name: "global-weekly-repair", run(state) {
  if (state.allocation) { state.explanations.push({ phase: this.name, message: "Réparation volumique désactivée : la matrice hebdomadaire est verrouillée.", reasons: ["Contrats préservés", "Jours obligatoires préservés", "Budgets journaliers préservés"] }); return }
  const initialDeltas = activeEmployees(state).map((employee) => `${employee.firstName} ${formatSignedMinutes(-contractRemaining(state, employee.id))}`)
  const outcome = searchWeeklyRepairs(state)
  state.shifts = outcome.shifts
  state.assignments = outcome.assignments
  for (const reason of outcome.reasons) state.explanations.push({ phase: this.name, message: reason, reasons: ["Meilleur plan trouvé sous l’objectif borné", "Comparaison lexicographique complète et déterministe"] })
  const unresolved = activeEmployees(state).filter((employee) => contractRemaining(state, employee.id) !== 0)
  for (const employee of unresolved) {
    const contract = state.context.contracts.find((item) => item.employeeId === employee.id)!
    contractIssue(state, employee, contractualMinutes(contract), contractRemaining(state, employee.id))
  }
  const diagnostics = [...state.repairAttempts.values()].filter((entry) => entry.generated > 0).sort((a, b) => a.family.localeCompare(b.family)).map((entry) => `${entry.family} : ${entry.generated} générée(s), ${entry.rejected} rejetée(s), ${entry.evaluated} évaluée(s), ${entry.accepted} acceptée(s)`)
  const finalDeltas = activeEmployees(state).map((employee) => `${employee.firstName} ${formatSignedMinutes(-contractRemaining(state, employee.id))}`)
  state.explanations.push({ phase: this.name, message: unresolved.length ? `${unresolved.length} contrat(s) exact(s) restent impossibles après épuisement de la recherche bornée.` : "Les contrats ont été rééquilibrés sur l’ensemble de la semaine.", reasons: [`Écarts initiaux : ${initialDeltas.join(", ")}`, `Écarts finaux : ${finalDeltas.join(", ")}`, ...diagnostics] })
} }

const optimisationPhase: PlanningPipelinePhase = { name: "optimisation", run(state) {
  if (state.allocation) return
  mergeEmployeeDayShifts(state, 0)
  removeUnusedShifts(state)
  state.explanations.push({ phase: this.name, message: "Les décisions légales et de couverture ont été conservées ; aucun échange sûr n’améliorait le planning.", reasons: ["La légalité prime", "La couverture prime", "Les préférences restent secondaires"] })
} }

const finalValidationPhase: PlanningPipelinePhase = { name: "final-validation", run(state) {
  normalizeAndValidate(state)
  reportCoverage(state)
  reportDistribution(state)
  state.explanations.push({ phase: this.name, message: "Planning transmis aux moteurs de contraintes, couverture, statistiques, équité et scoring.", reasons: ["Évaluation finale exécutée par les services Core existants"] })
} }

export const BUSINESS_PIPELINE_PHASES: readonly PlanningPipelinePhase[] = [validationPhase, demandCalculationPhase, weeklyAllocationPhase, dailyPlacementPhase, closingAssignmentPhase, legalRestPhase, openingAssignmentPhase, coveragePhase, contractCompletionPhase, globalWeeklyRepairPhase, optimisationPhase, finalValidationPhase]

export function runBusinessPipeline(context: GenerationContext): GenerationPlan {
  const state: PipelineState = { context, requirements: [], shifts: [], assignments: [], rankings: [], explanations: [], issues: [], trace: [], rejected: 0, evaluations: 0, closingCounts: new Map(), repairAttempts: new Map(), allocation: null }
  for (const phase of BUSINESS_PIPELINE_PHASES) {
    state.trace.push(phase.name); phase.run(state)
    if ((phase.name === "validation" || phase.name === "weekly-allocation") && state.issues.some((entry) => entry.severity === "blocking")) break
  }
  return { shifts: state.shifts, assignments: state.assignments, candidatesRejectedByHardConstraints: state.rejected, constraintEvaluations: state.evaluations, assignmentRankings: state.rankings, explanations: state.explanations, issues: state.issues, phaseTrace: state.trace, repairAttempts: [...state.repairAttempts.values()].map((entry): RepairAttemptStatistics => ({ ...entry })).sort((a, b) => a.family.localeCompare(b.family)), weeklyAllocation: state.allocation ?? undefined }
}

export function repairWeeklyPlan(context: GenerationContext, requirements: readonly CoverageRequirement[], shifts: readonly Shift[], assignments: readonly Assignment[]) {
  const state: PipelineState = { context, requirements, shifts: [...shifts], assignments: [...assignments], rankings: [], explanations: [], issues: [], trace: ["global-weekly-repair"], rejected: 0, evaluations: 0, closingCounts: new Map(), repairAttempts: new Map(), allocation: null }
  const before = weeklyObjective(state, shifts, assignments)
  const outcome = searchWeeklyRepairs(state)
  const after = weeklyObjective(state, outcome.shifts, outcome.assignments)
  return { ...outcome, before, after, repairAttempts: [...state.repairAttempts.values()].map((entry): RepairAttemptStatistics => ({ ...entry })).sort((a, b) => a.family.localeCompare(b.family)) }
}

function fillRequirement(state: PipelineState, requirement: CoverageRequirement, phase: PipelinePhaseName, closing: boolean) {
  const assigned = new Set(assignedFor(state, requirement).map((item) => item.employeeId))
  while (assigned.size < requirement.minEmployees && assigned.size < (requirement.maxEmployees ?? Infinity)) {
    const ranked = activeEmployees(state).filter((employee) => !assigned.has(employee.id)).filter((employee) => supports(employee, requirement)).map((employee) => proposalFor(state, employee, requirement, closing)).filter((proposal): proposal is ShiftProposal => proposal !== null).sort((a, b) => b.score - a.score || String(a.employee.id).localeCompare(String(b.employee.id)))
    const admissible = ranked.filter((proposal) => proposalAllowed(state, proposal, requirement, closing))
    if (!admissible.length) break
    const best = admissible[0], candidate = applyProposal(state, best)
    assigned.add(best.employee.id)
    if (closing) state.closingCounts.set(best.employee.id, (state.closingCounts.get(best.employee.id) ?? 0) + 1)
    const selected = rankedCandidate(best.employee.id, best.score, closing), alternatives = admissible.slice(1).map(({ employee, score }) => rankedCandidate(employee.id, score, closing))
    state.rankings.push({ assignmentId: candidate.id, requirementId: requirement.id, shiftId: candidate.shiftId, selected, alternatives })
    const continuity = best.kind === "extend" ? "Shift continu existant étendu pour couvrir la plage" : best.kind === "split" ? "Deuxième plage autorisée dans la limite de coupure" : "Journée de travail continue créée"
    explain(state, phase, candidate, requirement, closing ? [continuity, ...closingReasons(state, best.employee)] : [continuity, "Respecte les contraintes légales", phase === "opening-assignment" ? "Ouverture affectée après le repos légal" : "Renforce la couverture configurée"])
  }
}

interface ShiftProposal { readonly employee: Employee; readonly score: number; readonly kind: "new" | "extend" | "split"; readonly shift: Shift; readonly current?: Shift; readonly assignment?: Assignment }

function proposalFor(state: PipelineState, employee: Employee, requirement: CoverageRequirement, closing: boolean): ShiftProposal | null {
  const dayAssignments = state.assignments.filter((assignment) => assignment.employeeId === employee.id).map((assignment) => ({ assignment, shift: shiftFor(state, assignment.shiftId) })).filter((entry): entry is { assignment: Assignment; shift: Shift } => !!entry.shift && entry.shift.date === requirement.window.date)
  const requirementTemplate = shiftForRequirement(state, requirement)
  const requirementShift = buildEmployeeShiftForRequirement(requirementTemplate, requirement, employee.id)
  if (dayAssignments.length === 0) return { employee, score: candidateScore(state, employee, closing), kind: "new", shift: requirementShift }
  const mergeable = dayAssignments.map((entry) => ({ ...entry, merged: mergeShift(entry.shift, requirementShift), gap: gapBetween(entry.shift, requirementShift) })).filter((entry) => entry.gap <= 15 && shiftDuration(entry.merged) <= (state.context.settings.maximumDailyMinutes ?? 600)).sort((a, b) => a.gap - b.gap)[0]
  if (mergeable) return { employee, score: candidateScore(state, employee, closing) + 10_000, kind: "extend", shift: mergeable.merged, current: mergeable.shift, assignment: mergeable.assignment }
  if (dayAssignments.length >= 2 || !splitPermitted(state, employee, requirement, dayAssignments[0].shift, requirementShift)) return null
  return { employee, score: candidateScore(state, employee, closing) + 100, kind: "split", shift: requirementShift }
}

function proposalAllowed(state: PipelineState, proposal: ShiftProposal, requirement: CoverageRequirement, closing: boolean) {
  if (closing && !canClose(state, proposal.employee)) { state.rejected++; return false }
  if (contractDelta(state, proposal) > contractRemaining(state, proposal.employee.id)) { state.rejected++; return false }
  const candidate = buildAssignment(state.context.planning, proposal.shift, proposal.employee, state.context.settings)
  if (proposal.kind === "extend" && proposal.current && proposal.assignment) {
    const shifts = state.shifts.map((item) => item.id === proposal.current!.id ? proposal.shift : item)
    if (validateCandidatePlan(state.context, state.requirements, shifts, state.assignments).length) { state.rejected++; return false }
    return true
  }
  return candidateAllowed(state, proposal.employee, proposal.shift, candidate, requirement, closing)
}

function applyProposal(state: PipelineState, proposal: ShiftProposal): Assignment {
  if (proposal.kind === "extend" && proposal.current && proposal.assignment) {
    state.shifts = state.shifts.map((shift) => shift.id === proposal.current!.id ? proposal.shift : shift)
    return proposal.assignment
  }
  const assignment = buildAssignment(state.context.planning, proposal.shift, proposal.employee, state.context.settings)
  state.shifts.push(proposal.shift)
  state.assignments.push(assignment)
  return assignment
}

function candidateAllowed(state: PipelineState, employee: Employee, shift: Shift, candidate: Assignment, requirement?: CoverageRequirement, closing = false) {
  if (closing && !canClose(state, employee)) { state.rejected++; return false }
  if (overlapsExisting(state, employee.id, shift)) { state.rejected++; return false }
  const candidateShifts = state.shifts.some((item) => item.id === shift.id) ? state.shifts : [...state.shifts, shift]
  if (validateCandidatePlan(state.context, state.requirements, candidateShifts, [...state.assignments, candidate]).length) { state.rejected++; return false }
  const allowed = isAdmissibleAddition(state.context.evaluator, state.context.registry, state.context, candidateShifts, state.assignments, candidate)
  state.evaluations++; if (!allowed) state.rejected++; return allowed
}
function canClose(state: PipelineState, employee: Employee) { const capablePool = activeEmployees(state).some((item) => item.capabilities.includes("CAN_CLOSE")); if (capablePool && !employee.capabilities.includes("CAN_CLOSE")) return false; const max = state.context.employeeConstraints.find((item) => item.employeeId === employee.id && item.type === "MAX_CLOSINGS")?.value; return max == null || (state.closingCounts.get(employee.id) ?? 0) < max }
function supports(employee: Employee, requirement: CoverageRequirement) { return (requirement.requiredCapabilities ?? []).every((key) => employee.capabilities.includes(key)) }
function candidateScore(state: PipelineState, employee: Employee, closing: boolean) { const contract = state.context.contracts.find((item) => item.employeeId === employee.id); const load = contract ? assignedMinutes(state, employee.id) / Math.max(1, contractualMinutes(contract)) : 0; const preferred = closing && state.context.business.employeePreferences?.some((item) => item.employeeId === employee.id && item.prefersClosing); return (preferred ? 1000 : 0) - (closing ? (state.closingCounts.get(employee.id) ?? 0) * 100 : 0) - load }
function rankedCandidate(employeeId: EmployeeId, score: number, closing: boolean): RankedCandidate { return { employeeId, score, contributions: [{ dimension: closing ? "closing-business-priority" : "coverage-business-priority", weight: 1, rawScore: score, weightedScore: score }] } }
function closingReasons(state: PipelineState, employee: Employee) { const preferred = state.context.business.employeePreferences?.some((item) => item.employeeId === employee.id && item.prefersClosing); return [preferred ? "Préfère les fermetures" : "Éligible à la fermeture", "Reste sous son maximum hebdomadaire", "Respecte les contraintes légales", "Équilibre le nombre de fermetures"] }
function extendExistingShifts(state: PipelineState, employee: Employee, remaining: number, increment: number, maximum: number) {
  for (const assignment of state.assignments.filter((item) => item.employeeId === employee.id)) {
    if (remaining <= 0) break
    const shift = shiftFor(state, assignment.shiftId)
    if (!shift) continue
    const segment = shift.segments[0], current = intervalMinutes(segment.startTime, segment.endTime, segment.endDayOffset) ?? 0, day = storeDay(state.context, shift.date)
    if (!day || day.closed || !day.closesAt) continue
    const capacity = Math.min(maximum - current, timeToMinutes(day.closesAt)! - timeToMinutes(segment.endTime)!, remaining)
    for (let extension = Math.floor(capacity / increment) * increment; extension > 0; extension -= increment) {
      const next = { ...shift, segments: [{ ...segment, endTime: toTime(timeToMinutes(segment.endTime)! + extension) }] }
      const candidateShifts = state.shifts.map((item) => item.id === shift.id ? next : item)
      if (validateCandidatePlan(state.context, state.requirements, candidateShifts, state.assignments).length) continue
      state.shifts = candidateShifts; remaining -= extension
      explain(state, "contract-completion", assignment, undefined, ["Shift individuel étendu après validation complète", `Extension de ${extension} minutes`])
      break
    }
  }
  return remaining
}
function syntheticShift(state: PipelineState, employeeId: EmployeeId, date: string, start: TimeString, duration: number): Shift { return { id: `shift_contract_${employeeId}_${date}` as ShiftId, storeId: state.context.store.id, templateId: null, date, source: "dynamic", segments: [{ startTime: start, endTime: toTime(timeToMinutes(start)! + duration) }], createdAt: state.context.settings.now, updatedAt: state.context.settings.now } }
function minimumShiftFor(state: PipelineState, employeeId: EmployeeId) { const sectorMinimums = (state.context.business.sectors ?? []).filter((sector) => sector.assignedEmployeeIds.includes(employeeId)).map((sector) => sector.minimumShiftDuration); return Math.max(15, sectorMinimums.length ? Math.max(...sectorMinimums) : state.context.store.planningSettings.minShiftDuration ?? 120) }
function overlapsExisting(state: PipelineState, employeeId: EmployeeId, candidate: Shift) { const start = timeToMinutes(candidate.segments[0].startTime)!, end = start + (intervalMinutes(candidate.segments[0].startTime, candidate.segments[0].endTime, candidate.segments[0].endDayOffset) ?? 0); return state.assignments.filter((item) => item.employeeId === employeeId).map((item) => shiftFor(state, item.shiftId)).filter((shift): shift is Shift => !!shift && shift.date === candidate.date).some((shift) => { const otherStart = timeToMinutes(shift.segments[0].startTime)!, otherEnd = otherStart + (intervalMinutes(shift.segments[0].startTime, shift.segments[0].endTime, shift.segments[0].endDayOffset) ?? 0); return start < otherEnd && otherStart < end }) }
function assignedMinutes(state: PipelineState, employeeId: EmployeeId) { return state.assignments.filter((item) => item.employeeId === employeeId).reduce((sum, item) => { const shift = shiftFor(state, item.shiftId); return sum + (shift?.segments.reduce((total, segment) => total + (intervalMinutes(segment.startTime, segment.endTime, segment.endDayOffset) ?? 0), 0) ?? 0) }, 0) }
function activeEmployees(state: PipelineState) { return [...state.context.employees].filter((item) => item.status === "active").sort((a, b) => String(a.id).localeCompare(String(b.id))) }
function shiftForRequirement(state: PipelineState, requirement: CoverageRequirement) { return state.shifts.find((item) => item.id === `shift_${requirement.id}`)! }
function shiftFor(state: PipelineState, id: ShiftId) { return state.shifts.find((item) => item.id === id) }
function assignedFor(state: PipelineState, requirement: CoverageRequirement) { return state.assignments.filter((assignment) => { const shift = shiftFor(state, assignment.shiftId); return !!shift && coversRequirement(shift, requirement) && supports(state.context.employees.find((employee) => employee.id === assignment.employeeId)!, requirement) }) }
function storeDay(context: GenerationContext, date: string) { return context.store.openingHours.find((item) => item.day === weekDayOf(date)) }
function isClosing(context: GenerationContext, requirement: CoverageRequirement) { const sector = context.business.sectors?.find((item) => item.requirementIds.includes(String(requirement.id))); const sameDay = context.demand.requirements.filter((item) => item.window.date === requirement.window.date && (!sector || sector.requirementIds.includes(String(item.id)))); const finalEnd = sameDay.map((item) => item.window.end).sort().at(-1); return requirement.window.end === finalEnd }
function isOpening(context: GenerationContext, requirement: CoverageRequirement) { const day = storeDay(context, requirement.window.date); return !!day && !day.closed && requirement.window.start === day.opensAt }
function issue(state: PipelineState, code: string, severity: PlanningIssueSeverity, phase: PipelinePhaseName, message: string, requirement?: CoverageRequirement, employeeId?: EmployeeId, details?: Readonly<Record<string, string | number>>) { state.issues.push({ code, severity, phase, message, requirementId: requirement?.id, employeeId, details }) }
function explain(state: PipelineState, phase: PipelinePhaseName, assignment: Assignment, requirement: CoverageRequirement | undefined, reasons: string[]) { state.explanations.push({ phase, assignmentId: assignment.id, employeeId: assignment.employeeId, requirementId: requirement?.id, message: `${assignment.employeeId} affecté pendant la phase ${phase}.`, reasons }) }
function addDays(date: string, count: number) { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + count); return value.toISOString().slice(0, 10) }
function toTime(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}` as TimeString }
function dates(start: string, end: string) { const result: string[] = []; for (let value = start; value <= end; value = addDays(value, 1)) result.push(value); return result }

function coversRequirement(shift: Shift, requirement: CoverageRequirement) { if (shift.date !== requirement.window.date) return false; const start = timeToMinutes(requirement.window.start)!, end = timeToMinutes(requirement.window.end)!; return shift.segments.some((segment) => timeToMinutes(segment.startTime)! <= start && timeToMinutes(segment.endTime)! >= end) }
function shiftDuration(shift: Shift) { return shift.segments.reduce((sum, segment) => sum + (intervalMinutes(segment.startTime, segment.endTime, segment.endDayOffset) ?? 0), 0) }
function mergeShift(existing: Shift, fragment: Shift): Shift { const starts = [existing.segments[0].startTime, fragment.segments[0].startTime], ends = [existing.segments[0].endTime, fragment.segments[0].endTime]; return { ...existing, segments: [{ startTime: starts.sort()[0], endTime: ends.sort().at(-1)! }] } }
function gapBetween(first: Shift, second: Shift) { const firstStart = timeToMinutes(first.segments[0].startTime)!, firstEnd = timeToMinutes(first.segments[0].endTime)!, secondStart = timeToMinutes(second.segments[0].startTime)!, secondEnd = timeToMinutes(second.segments[0].endTime)!; if (firstStart <= secondEnd && secondStart <= firstEnd) return 0; return Math.max(secondStart - firstEnd, firstStart - secondEnd) }
function sectorForRequirement(state: PipelineState, requirement: CoverageRequirement) { return state.context.business.sectors?.find((sector) => sector.requirementIds.includes(String(requirement.id))) }
function splitPermitted(state: PipelineState, employee: Employee, requirement: CoverageRequirement, first: Shift, second: Shift) { if (!employee.capabilities.includes("CAN_SPLIT_SHIFT")) return false; const sector = sectorForRequirement(state, requirement); if (!sector?.splitShiftAllowed || !sector.maximumSplitDuration) return false; return gapBetween(first, second) <= sector.maximumSplitDuration }
function removeUnusedShifts(state: PipelineState) { const used = new Set(state.assignments.map((assignment) => assignment.shiftId)); state.shifts = state.shifts.filter((shift) => used.has(shift.id)) }
function mergeEmployeeDayShifts(state: PipelineState, maximumGap: number) { const maximum = state.context.settings.maximumDailyMinutes ?? 600; for (const employee of activeEmployees(state)) { for (const date of dates(state.context.settings.period.start, state.context.settings.period.end)) { let changed = true; while (changed) { changed = false; const entries = state.assignments.filter((assignment) => assignment.employeeId === employee.id).map((assignment) => ({ assignment, shift: shiftFor(state, assignment.shiftId) })).filter((entry): entry is { assignment: Assignment; shift: Shift } => !!entry.shift && entry.shift.date === date).sort((a, b) => a.shift.segments[0].startTime.localeCompare(b.shift.segments[0].startTime)); for (let index = 0; index < entries.length - 1; index++) { const first = entries[index], second = entries[index + 1], merged = mergeShift(first.shift, second.shift); if (gapBetween(first.shift, second.shift) > maximumGap || shiftDuration(merged) > maximum) continue; state.shifts = state.shifts.map((shift) => shift.id === first.shift.id ? merged : shift); state.assignments = state.assignments.filter((assignment) => assignment.id !== second.assignment.id); changed = true; break } } } } }
function validateDailyShiftRealism(state: PipelineState) { for (const employee of activeEmployees(state)) { for (const date of dates(state.context.settings.period.start, state.context.settings.period.end)) { const shifts = employeeDayShifts(state, employee.id, date); if (shifts.length > 2) issue(state, "too_many_daily_shifts", "blocking", "optimisation", `Plus de deux shifts ont été générés pour ${employee.firstName} le ${date}.`, undefined, employee.id); if (shifts.length === 2) { const requirement = state.requirements.find((item) => item.window.date === date && coversRequirement(shifts[1], item)); const sector = requirement ? sectorForRequirement(state, requirement) : undefined; if (!employee.capabilities.includes("CAN_SPLIT_SHIFT") || !sector?.splitShiftAllowed) issue(state, "split_forbidden", "blocking", "optimisation", `Une coupure interdite a été générée pour ${employee.firstName} le ${date}.`, undefined, employee.id); else if (!sector.maximumSplitDuration || gapBetween(shifts[0], shifts[1]) > sector.maximumSplitDuration) issue(state, "split_duration_exceeded", "blocking", "optimisation", `La coupure maximale est dépassée pour ${employee.firstName} le ${date}.`, undefined, employee.id) } } } }

function coherentShiftForRequirement(state: PipelineState, requirement: CoverageRequirement): Shift {
  const base = buildShiftForRequirement(requirement, state.context.store, state.context.settings)
  const minimum = sectorForRequirement(state, requirement)?.minimumShiftDuration ?? state.context.store.planningSettings.minShiftDuration ?? 120
  if (shiftDuration(base) >= minimum) return base
  const day = storeDay(state.context, requirement.window.date)
  if (!day || day.closed || !day.opensAt || !day.closesAt) return base
  const open = timeToMinutes(day.opensAt)!, close = timeToMinutes(day.closesAt)!, start = timeToMinutes(requirement.window.start)!, end = timeToMinutes(requirement.window.end)!
  let expandedStart = isClosing(state.context, requirement) ? end - minimum : start
  expandedStart = Math.max(open, Math.min(expandedStart, close - minimum))
  return { ...base, segments: [{ startTime: toTime(expandedStart), endTime: toTime(expandedStart + minimum) }] }
}

function contractRemaining(state: PipelineState, employeeId: EmployeeId) { const contract = state.context.contracts.find((item) => item.employeeId === employeeId); return contract ? contractualMinutes(contract) - assignedMinutes(state, employeeId) : 0 }
function contractDelta(state: PipelineState, proposal: ShiftProposal) { return proposal.kind === "extend" && proposal.current ? shiftDuration(proposal.shift) - shiftDuration(proposal.current) : shiftDuration(proposal.shift) }
function employeeDayShifts(state: PipelineState, employeeId: EmployeeId, date: string) { return state.assignments.filter((assignment) => assignment.employeeId === employeeId).map((assignment) => shiftFor(state, assignment.shiftId)).filter((shift): shift is Shift => !!shift && shift.date === date).sort((a, b) => a.segments[0].startTime.localeCompare(b.segments[0].startTime)) }

function contractIssue(state: PipelineState, employee: Employee, target: number, difference: number) {
  const assigned = target - difference
  const direction = difference > 0 ? "manquantes" : "en excès"
  issue(state, "contract_inexact", "blocking", "contract-completion", `Génération bloquée pour ${employee.firstName} : objectif contractuel ${target} minutes, ${assigned} minutes assignables, ${Math.abs(difference)} minutes ${direction}. Aucune redistribution respectant les règles bloquantes et le shift minimum n’a été trouvée.`, undefined, employee.id, { contractualTargetMinutes: target, assignableMinutes: assigned, differenceMinutes: difference, requiredAction: "Modifier la configuration ou renforcer l’effectif." })
}

function normalizeAndValidate(state: PipelineState) {
  mergeEmployeeDayShifts(state, 0)
  removeUnusedShifts(state)
  validateDailyShiftRealism(state)
  for (const violation of validateCandidatePlan(state.context, state.requirements, state.shifts, state.assignments)) if (!state.issues.some((item) => item.code === violation.code && item.employeeId === violation.employeeId)) issue(state, violation.code, "blocking", "final-validation", violation.message, undefined, violation.employeeId)
  for (const employee of activeEmployees(state)) {
    const contract = state.context.contracts.find((item) => item.employeeId === employee.id)
    if (contract) {
      const target = contractualMinutes(contract), assigned = assignedMinutes(state, employee.id)
      if (assigned !== target && !state.issues.some((item) => item.code === "contract_inexact" && item.employeeId === employee.id)) contractIssue(state, employee, target, target - assigned)
    }
    for (const shift of state.assignments.filter((item) => item.employeeId === employee.id).map((item) => shiftFor(state, item.shiftId)).filter((item): item is Shift => !!item)) {
      const minimum = minimumShiftFor(state, employee.id)
      if (shiftDuration(shift) < minimum) issue(state, "minimum_shift_violated", "blocking", "final-validation", `Shift invalide pour ${employee.firstName} le ${shift.date} : ${shiftDuration(shift)} minutes au lieu du minimum de ${minimum} minutes.`, undefined, employee.id, { actualMinutes: shiftDuration(shift), minimumMinutes: minimum })
    }
  }
}

function reportCoverage(state: PipelineState) {
  const surplusByDate = new Map<string, number>()
  for (const requirement of state.requirements) {
    const assigned = assignedFor(state, requirement).length, deficit = Math.max(0, requirement.minEmployees - assigned), surplus = Math.max(0, assigned - requirement.minEmployees)
    if (!deficit && !surplus) continue
    const label = `${requirement.window.date} de ${requirement.window.start} à ${requirement.window.end}`
    if (deficit) issue(state, "coverage_degraded", "degradation", "final-validation", `Couverture dégradée ${label} : ${requirement.minEmployees} salarié(s) demandé(s), ${assigned} planifié(s), déficit ${deficit}.`, requirement, undefined, { requiredEmployees: requirement.minEmployees, assignedEmployees: assigned, deficit, surplus })
    if (surplus) {
      const minutes = surplus * (intervalMinutes(requirement.window.start, requirement.window.end) ?? 0)
      surplusByDate.set(requirement.window.date, (surplusByDate.get(requirement.window.date) ?? 0) + minutes)
      issue(state, "coverage_surplus_detail", "information", "final-validation", `${requirement.window.date} de ${requirement.window.start} à ${requirement.window.end} : ${surplus} présence(s) excédentaire(s), soit ${minutes} minutes-salarié.`, requirement, undefined, { requiredEmployees: requirement.minEmployees, assignedEmployees: assigned, surplus, surplusEmployeeMinutes: minutes })
      if (isClosing(state.context, requirement)) issue(state, "closing_surplus", "degradation", "final-validation", `${requirement.window.date} : ${surplus === 1 ? "une fermeture excédentaire reste planifiée" : `${surplus} fermetures excédentaires restent planifiées`}.`, requirement, undefined, { requiredEmployees: requirement.minEmployees, assignedEmployees: assigned, surplus })
    }
  }
  const totalSurplus = [...surplusByDate.values()].reduce((sum, minutes) => sum + minutes, 0), structural = structuralSurplusMinutes(state), avoidable = Math.max(0, totalSurplus - structural)
  if (structural > 0) issue(state, "structural_surplus", "information", "final-validation", `${formatMinutes(structural)} de surplus sont structurellement inévitables : les contrats exacts dépassent la couverture minimale configurée.`, undefined, undefined, { structuralSurplusEmployeeMinutes: structural, minimumCoverageEmployeeMinutes: minimumCoverageMinutes(state), contractualEmployeeMinutes: sectorContractMinutes(state) })
  for (const [date, minutes] of [...surplusByDate].sort(([left], [right]) => left.localeCompare(right))) issue(state, "coverage_surplus_summary", "information", "final-validation", `${date} : ${formatMinutes(minutes)} salarié-heures excédentaires.`, undefined, undefined, { surplusEmployeeMinutes: minutes })
  if (avoidable > 0) issue(state, "avoidable_surplus", "degradation", "final-validation", `${formatMinutes(avoidable)} de surplus évitable subsistent après couverture des déficits.`, undefined, undefined, { avoidableSurplusEmployeeMinutes: avoidable, structuralSurplusEmployeeMinutes: structural })
}

function reportDistribution(state: PipelineState) {
  for (const metric of distributionMetrics(state, state.shifts, state.assignments)) if (metric.errorMinutes > 0) issue(state, "daily_distribution_imperfect", "degradation", "final-validation", `${metric.sectorName} — ${metric.day} : ${formatMinutes(metric.actualMinutes)} planifiées pour un objectif de ${formatMinutes(metric.targetMinutes)}.`, undefined, undefined, { actualMinutes: metric.actualMinutes, targetMinutes: metric.targetMinutes, differenceMinutes: metric.actualMinutes - metric.targetMinutes })
}

function formatMinutes(minutes: number) { const hours = Math.floor(minutes / 60), remainder = minutes % 60; return remainder ? `${hours} h ${String(remainder).padStart(2, "0")}` : `${hours} h` }
function formatSignedMinutes(minutes: number) { return `${minutes >= 0 ? "+" : ""}${minutes}` }

interface PlacementOption { readonly employeeId: EmployeeId; readonly shift: Shift; readonly assignment: Assignment; readonly coverage: ReadonlySet<string> }
interface PlacementNode { readonly options: readonly PlacementOption[]; readonly objective: readonly number[]; readonly hash: string }

function placeAllocatedWeek(state: PipelineState) {
  const allocation = state.allocation!
  const closingPlan = allocateWeeklyClosingOwners(state), closingOwners = closingPlan.owners
  state.shifts = []; state.assignments = []
  for (const date of dates(state.context.settings.period.start, state.context.settings.period.end)) {
    const scheduled = allocation.rows.map((row) => ({ row, minutes: row.minutesByDate[date] ?? 0 })).filter((item) => item.minutes > 0).sort((left, right) => String(left.row.employeeId).localeCompare(String(right.row.employeeId)))
    if (!scheduled.length) continue
    const optionsByEmployee = new Map<EmployeeId, PlacementOption[]>()
    for (const item of scheduled) {
      const employee = state.context.employees.find((candidate) => candidate.id === item.row.employeeId)!, day = storeDay(state.context, date)
      if (!day || day.closed || !day.opensAt || !day.closesAt) { issue(state, "allocated_day_closed", "blocking", "daily-placement", `${employee.firstName} possède ${item.minutes} minutes allouées sur un jour fermé (${date}).`, undefined, employee.id); continue }
      const open = timeToMinutes(day.opensAt)!, close = timeToMinutes(day.closesAt)!, increment = state.context.settings.timeIncrementMinutes ?? 15, equivalent = new Map<string, PlacementOption>()
      for (let start = open; start + item.minutes <= close; start += increment) {
        const shift = syntheticShift(state, employee.id, date, toTime(start), item.minutes), assignment = buildAssignment(state.context.planning, shift, employee, state.context.settings)
        const closingOwner = closingOwners.get(date), closesDay = start + item.minutes === close
        if ((closingOwner === employee.id && !closesDay) || (closingOwner !== employee.id && closesDay)) continue
        if (start === open && mustReserveOpening(state, employee.id, date)) continue
        if (start + item.minutes === close && mustReserveClosing(state, employee.id, date)) continue
        if (validateCandidatePlan(state.context, state.requirements, [...state.shifts, shift], [...state.assignments, assignment]).length === 0) { const coverage = new Set(state.requirements.filter((requirement) => requirement.window.date === date && coversRequirement(shift, requirement) && supports(employee, requirement)).map((requirement) => String(requirement.id))), signature = [...coverage].join("|"); if (!equivalent.has(signature)) equivalent.set(signature, { employeeId: employee.id, shift, assignment, coverage }) }
      }
      const allOptions = [...equivalent.values()], dailyRequirements = state.requirements.filter((requirement) => requirement.window.date === date)
      allOptions.sort((left, right) => { const weight = (option: PlacementOption) => dailyRequirements.reduce((sum, requirement) => sum + (option.coverage.has(String(requirement.id)) ? requirement.minEmployees : 0), 0); return weight(right) - weight(left) || left.shift.segments[0].startTime.localeCompare(right.shift.segments[0].startTime) })
      const boundary = [allOptions.find((option) => option.shift.segments[0].startTime === day.opensAt), allOptions.find((option) => option.shift.segments.at(-1)!.endTime === day.closesAt)].filter((option): option is PlacementOption => !!option), representatives = dailyRequirements.map((requirement) => allOptions.find((option) => option.coverage.has(String(requirement.id)))).filter((option): option is PlacementOption => !!option)
      const options = [...new Map([...boundary, ...representatives, ...allOptions].map((option) => [option.shift.segments[0].startTime, option])).values()]
      if (!options.length) issue(state, "daily_placement_impossible", "blocking", "daily-placement", `${employee.firstName} : aucune position légale pour ${item.minutes} minutes le ${date}.`, undefined, employee.id, { allocatedMinutes: item.minutes })
      optionsByEmployee.set(employee.id, options)
    }
    if (scheduled.some((item) => !(optionsByEmployee.get(item.row.employeeId)?.length))) continue
    let best: PlacementNode | null = null, bestWithExactClosures: PlacementNode | null = null, evaluatedCombinations = 0
    const visit = (index: number, selected: readonly PlacementOption[]) => {
      if (index === scheduled.length) { evaluatedCombinations++; const objective = dailyPlacementObjective(state, date, selected, []), hash = selected.map((item) => `${item.employeeId}:${item.shift.segments[0].startTime}`).join("|"); const candidate = { options: selected, objective, hash }; if (!best || compareNumberArrays(candidate.objective, best.objective) < 0 || (compareNumberArrays(candidate.objective, best.objective) === 0 && candidate.hash.localeCompare(best.hash) < 0)) best = candidate; const requiredClosers = state.requirements.filter((requirement) => requirement.window.date === date && isClosing(state.context, requirement)).reduce((maximum, requirement) => Math.max(maximum, requirement.minEmployees), 0), actualClosers = selected.filter((option) => endsAtStoreClosing(state.context, option.shift)).length; if (actualClosers === requiredClosers && (!bestWithExactClosures || compareNumberArrays(candidate.objective, bestWithExactClosures.objective) < 0 || (compareNumberArrays(candidate.objective, bestWithExactClosures.objective) === 0 && candidate.hash.localeCompare(bestWithExactClosures.hash) < 0))) bestWithExactClosures = candidate; return }
      const remaining = scheduled.slice(index + 1).map((item) => optionsByEmployee.get(item.row.employeeId)!), employeeOptions = optionsByEmployee.get(scheduled[index].row.employeeId)!
      for (const option of employeeOptions) { const next = [...selected, option], optimistic = dailyPlacementObjective(state, date, next, remaining); if (bestWithExactClosures && (optimistic[0] > bestWithExactClosures.objective[0] || (optimistic[0] === bestWithExactClosures.objective[0] && optimistic[1] > bestWithExactClosures.objective[1]))) continue; visit(index + 1, next) }
    }
    visit(0, [])
    const selectedBest = (bestWithExactClosures ?? best) as PlacementNode | null
    if (!selectedBest) { issue(state, "daily_combination_impossible", "blocking", "daily-placement", `Aucune combinaison journalière légale trouvée le ${date}.`); continue }
    state.shifts.push(...selectedBest.options.map((option) => option.shift)); state.assignments.push(...selectedBest.options.map((option) => option.assignment))
    state.explanations.push({ phase: "daily-placement", message: `${date} : ${selectedBest.options.length} shifts placés globalement après verrouillage des durées ; optimum prouvé après ${evaluatedCombinations} combinaison(s) terminale(s).`, reasons: selectedBest.options.map((option) => `${state.context.employees.find((employee) => employee.id === option.employeeId)!.firstName} ${option.shift.segments[0].startTime}–${option.shift.segments[0].endTime}`) })
  }
  const actualDeficitSlots = state.requirements.filter((requirement) => assignedFor(state, requirement).length < requirement.minEmployees).length
  state.explanations.push({ phase: "daily-placement", message: actualDeficitSlots === closingPlan.coverageLowerBoundSlots ? `Borne inférieure globale atteinte : ${actualDeficitSlots} créneau(x) déficitaire(s), aucun déficit de créneau évitable.` : `Placement à ${actualDeficitSlots} créneau(x) déficitaire(s) pour une borne inférieure de ${closingPlan.coverageLowerBoundSlots}.`, reasons: [`${closingPlan.evaluatedPlans} combinaison(s) hebdomadaire(s) de fermetures évaluée(s).`, "Toutes les signatures de couverture issues des débuts possibles par pas de 15 minutes ont été explorées."] })
}

function allocateWeeklyClosingOwners(state: PipelineState) {
  const result = new Map<string, EmployeeId>(), datesWithClosing = dates(state.context.settings.period.start, state.context.settings.period.end).filter((date) => state.requirements.some((requirement) => requirement.window.date === date && isClosing(state.context, requirement) && requirement.minEmployees > 0)), allocation = state.allocation!, used = new Map<EmployeeId, number>()
  const candidates = (date: string) => allocation.rows.filter((row) => (row.minutesByDate[date] ?? 0) > 0).map((row) => state.context.employees.find((employee) => employee.id === row.employeeId)!).filter((employee) => employee.capabilities.includes("CAN_CLOSE")).filter((employee) => { const maximum = state.context.employeeConstraints.find((constraint) => constraint.employeeId === employee.id && constraint.type === "MAX_CLOSINGS")?.value; if (maximum != null && (used.get(employee.id) ?? 0) >= maximum) return false; const requiredOpener = (targetDate: string) => { const opening = state.requirements.filter((requirement) => requirement.window.date === targetDate && isOpening(state.context, requirement)).sort((a, b) => b.minEmployees - a.minEmployees)[0]; if (!opening) return false; const openers = allocation.rows.filter((row) => (row.minutesByDate[targetDate] ?? 0) > 0).map((row) => state.context.employees.find((candidate) => candidate.id === row.employeeId)!).filter((candidate) => candidate.capabilities.includes("CAN_OPEN")); return opening.minEmployees >= openers.length && openers.some((candidate) => candidate.id === employee.id) }; return !requiredOpener(date) && !requiredOpener(addDays(date, 1)) }).sort((left, right) => { const leftDays = allocation.rows.find((row) => row.employeeId === left.id) ? Object.values(allocation.rows.find((row) => row.employeeId === left.id)!.minutesByDate).filter((minutes) => minutes > 0).length : 0, rightDays = allocation.rows.find((row) => row.employeeId === right.id) ? Object.values(allocation.rows.find((row) => row.employeeId === right.id)!.minutesByDate).filter((minutes) => minutes > 0).length : 0; return leftDays - rightDays || String(left.id).localeCompare(String(right.id)) })
  const coverageCache = new Map<string, readonly [number, number]>()
  let best: Map<string, EmployeeId> | null = null, bestScore: readonly [number, number, number, number, string] | null = null, evaluatedPlans = 0
  const visit = (index: number) => {
    if (index === datesWithClosing.length) {
      evaluatedPlans++
      const coverage = datesWithClosing.reduce<readonly [number, number]>((total, date) => { const key = `${date}|${result.get(addDays(date, -1)) ?? ""}|${result.get(date) ?? ""}`; let value = coverageCache.get(key); if (!value) { value = minimumDailyCoverageScore(state, date, result.get(addDays(date, -1)), result.get(date)); coverageCache.set(key, value) } return [total[0] + value[0], total[1] + value[1]] }, [0, 0])
      const shortage = minimumOpeningShortage(state, result), fairness = [...used.values()].reduce((sum, count) => sum + count ** 2, 0), hash = datesWithClosing.map((date) => `${date}:${result.get(date)}`).join("|")
      const score: readonly [number, number, number, number, string] = [coverage[0], coverage[1], shortage, fairness, hash]
      const numericScore = score.slice(0, 4) as readonly number[], bestNumericScore = bestScore?.slice(0, 4) as readonly number[] | undefined
      if (!bestScore || compareNumberArrays(numericScore, bestNumericScore!) < 0 || (compareNumberArrays(numericScore, bestNumericScore!) === 0 && score[4].localeCompare(bestScore[4]) < 0)) { best = new Map(result); bestScore = score }
      return
    }
    const date = datesWithClosing[index]
    for (const employee of candidates(date)) { result.set(date, employee.id); used.set(employee.id, (used.get(employee.id) ?? 0) + 1); visit(index + 1); used.set(employee.id, used.get(employee.id)! - 1); result.delete(date) }
  }
  visit(0)
  result.clear()
  const selectedBest = best as Map<string, EmployeeId> | null
  if (selectedBest) for (const [date, employeeId] of selectedBest) result.set(date, employeeId)
  const selectedScore = bestScore as readonly [number, number, number, number, string] | null
  return { owners: result, coverageLowerBoundSlots: selectedScore?.[0] ?? Number.POSITIVE_INFINITY, evaluatedPlans }
}

function minimumDailyCoverageScore(state: PipelineState, date: string, previousOwner: EmployeeId | undefined, owner: EmployeeId | undefined): readonly [number, number] {
  const requirements = state.requirements.filter((requirement) => requirement.window.date === date), day = storeDay(state.context, date)
  if (!day?.opensAt || !day.closesAt) return [requirements.length, requirements.reduce((sum, requirement) => sum + requirement.minEmployees * (intervalMinutes(requirement.window.start, requirement.window.end) ?? 0), 0)]
  const open = timeToMinutes(day.opensAt)!, close = timeToMinutes(day.closesAt)!, increment = state.context.settings.timeIncrementMinutes ?? 15
  let states = new Set([requirements.map(() => 0).join(",")])
  for (const row of state.allocation!.rows.filter((item) => (item.minutesByDate[date] ?? 0) > 0)) {
    const employee = state.context.employees.find((item) => item.id === row.employeeId)!, duration = row.minutesByDate[date], signatures = new Map<string, readonly number[]>()
    for (let start = open; start + duration <= close; start += increment) {
      const closes = start + duration === close
      if ((employee.id === owner && !closes) || (employee.id !== owner && closes) || (start === open && !employee.capabilities.includes("CAN_OPEN")) || (start === open && mustReserveOpening(state, employee.id, date))) continue
      if (employee.id === previousOwner && 24 * 60 - close + start < (state.context.settings.minimumRestMinutes ?? 720)) continue
      const shift = syntheticShift(state, employee.id, date, toTime(start), duration), covered = requirements.map((requirement) => coversRequirement(shift, requirement) && supports(employee, requirement) ? 1 : 0), signature = covered.join("")
      if (!signatures.has(signature)) signatures.set(signature, covered)
    }
    const next = new Set<string>()
    for (const key of states) { const counts = key.split(",").map(Number); for (const covered of signatures.values()) next.add(counts.map((count, index) => Math.min(requirements[index].minEmployees, count + covered[index])).join(",")) }
    states = next
  }
  let best: readonly [number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  for (const key of states) { const counts = key.split(",").map(Number); let uncovered = 0, deficitMinutes = 0; for (const [index, requirement] of requirements.entries()) { const missing = Math.max(0, requirement.minEmployees - counts[index]); if (missing) { uncovered++; deficitMinutes += missing * (intervalMinutes(requirement.window.start, requirement.window.end) ?? 0) } } const candidate: readonly [number, number] = [uncovered, deficitMinutes]; if (compareNumberArrays(candidate, best) < 0) best = candidate }
  return best
}

function minimumOpeningShortage(state: PipelineState, closingOwners: ReadonlyMap<string, EmployeeId>) {
  const openingDays = dates(state.context.settings.period.start, state.context.settings.period.end).map((date) => ({ date, requirement: state.requirements.filter((requirement) => requirement.window.date === date && isOpening(state.context, requirement)).sort((left, right) => right.minEmployees - left.minEmployees)[0] })).filter((item): item is { date: string; requirement: CoverageRequirement } => !!item.requirement && item.requirement.minEmployees > 0)
  const openers = state.context.employees.filter((employee) => employee.status === "active" && employee.capabilities.includes("CAN_OPEN")).sort((left, right) => String(left.id).localeCompare(String(right.id))), maximums = openers.map((employee) => state.context.employeeConstraints.find((constraint) => constraint.employeeId === employee.id && constraint.type === "MAX_OPENINGS")?.value ?? openingDays.length), memo = new Map<string, number>()
  const choose = (values: readonly number[], count: number) => { const selections: number[][] = []; const visit = (offset: number, selected: number[]) => { selections.push([...selected]); if (selected.length === count) return; for (let index = offset; index < values.length; index++) visit(index + 1, [...selected, values[index]]) }; visit(0, []); return selections }
  const search = (dayIndex: number, usage: readonly number[]): number => {
    if (dayIndex === openingDays.length) return 0
    const key = `${dayIndex}|${usage.join(",")}`; if (memo.has(key)) return memo.get(key)!
    const { date, requirement } = openingDays[dayIndex], day = storeDay(state.context, date), previousOwner = closingOwners.get(addDays(date, -1)), owner = closingOwners.get(date), open = day?.opensAt ? timeToMinutes(day.opensAt)! : 0
    const eligible = openers.map((employee, index) => ({ employee, index })).filter(({ employee, index }) => (state.allocation!.rows.find((row) => row.employeeId === employee.id)?.minutesByDate[date] ?? 0) > 0 && usage[index] < maximums[index]).filter(({ employee }) => employee.id !== owner).filter(({ employee }) => { if (employee.id !== previousOwner) return true; const previousDay = storeDay(state.context, addDays(date, -1)), close = previousDay?.closesAt ? timeToMinutes(previousDay.closesAt)! : 24 * 60; return 24 * 60 - close + open >= (state.context.settings.minimumRestMinutes ?? 720) }).map(({ index }) => index)
    let best = Number.POSITIVE_INFINITY
    for (const selected of choose(eligible, Math.min(requirement.minEmployees, eligible.length))) { const nextUsage = [...usage]; for (const index of selected) nextUsage[index]++; best = Math.min(best, Math.max(0, requirement.minEmployees - selected.length) + search(dayIndex + 1, nextUsage)) }
    memo.set(key, best); return best
  }
  return search(0, openers.map(() => 0))
}

function dailyPlacementObjective(state: PipelineState, date: string, options: readonly PlacementOption[], remaining: readonly PlacementOption[][]): readonly number[] {
  const requirements = state.requirements.filter((requirement) => requirement.window.date === date), employeeIds = new Set(options.map((option) => option.employeeId))
  let uncovered = 0, deficitMinutes = 0, closingDeficit = 0, extraClosers = 0, surplus = 0, earlyDeficit = 0
  for (const requirement of requirements) {
    const assigned = options.filter((option) => option.coverage.has(String(requirement.id))).length
    const possible = remaining.filter((employeeOptions) => employeeOptions.some((option) => option.coverage.has(String(requirement.id)))).length
    const optimistic = assigned + possible, missing = Math.max(0, requirement.minEmployees - optimistic), duration = intervalMinutes(requirement.window.start, requirement.window.end) ?? 0
    if (missing) { uncovered++; deficitMinutes += missing * duration; earlyDeficit += missing * (24 * 60 - timeToMinutes(requirement.window.start)!) }
    if (isClosing(state.context, requirement)) { closingDeficit += missing; extraClosers += Math.max(0, assigned - requirement.minEmployees) }
    surplus += Math.max(0, assigned - requirement.minEmployees) * duration
  }
  const nextDate = addDays(date, 1), nextOpeningRequirement = state.requirements.filter((requirement) => requirement.window.date === nextDate && isOpening(state.context, requirement)).sort((a, b) => b.minEmployees - a.minEmployees)[0], nextOpeningTime = nextOpeningRequirement ? timeToMinutes(nextOpeningRequirement.window.start)! : null
  const nextEligible = nextOpeningRequirement ? state.allocation!.rows.filter((row) => (row.minutesByDate[nextDate] ?? 0) > 0).map((row) => state.context.employees.find((employee) => employee.id === row.employeeId)!).filter((employee) => employee.capabilities.includes("CAN_OPEN")) : []
  const nextOpeningCapable = nextEligible.filter((employee) => { const max = state.context.employeeConstraints.find((constraint) => constraint.employeeId === employee.id && constraint.type === "MAX_OPENINGS")?.value, used = state.assignments.filter((assignment) => assignment.employeeId === employee.id).map((assignment) => shiftFor(state, assignment.shiftId)).filter((shift): shift is Shift => !!shift && shift.segments[0].startTime === storeDay(state.context, shift.date)?.opensAt).length + (options.some((option) => option.employeeId === employee.id && option.shift.segments[0].startTime === storeDay(state.context, date)?.opensAt) ? 1 : 0); if (max != null && used >= max) return false; const today = options.find((option) => option.employeeId === employee.id); if (!today || nextOpeningTime === null) return true; const end = timeToMinutes(today.shift.segments.at(-1)!.endTime)!; return 24 * 60 - end + nextOpeningTime >= (state.context.settings.minimumRestMinutes ?? 720) }).length
  const nextOpeningDeficit = nextOpeningRequirement ? Math.max(0, nextOpeningRequirement.minEmployees - nextOpeningCapable) : 0
  const scarcity = options.reduce((sum, option) => { const employee = state.context.employees.find((item) => item.id === option.employeeId)!, opens = option.shift.segments[0].startTime === storeDay(state.context, date)?.opensAt; const max = state.context.employeeConstraints.find((constraint) => constraint.employeeId === employee.id && constraint.type === "MAX_OPENINGS")?.value; return sum + (opens && max != null ? 100 : 0) }, 0)
  const fairness = [...employeeIds].reduce((sum, employeeId) => { const priorClosings = state.assignments.filter((assignment) => assignment.employeeId === employeeId).map((assignment) => shiftFor(state, assignment.shiftId)).filter((shift): shift is Shift => !!shift && endsAtStoreClosing(state.context, shift)).length, closes = options.some((option) => option.employeeId === employeeId && endsAtStoreClosing(state.context, option.shift)); return sum + (priorClosings + (closes ? 1 : 0)) ** 2 }, 0)
  const nextOpeningMinutes = nextOpeningRequirement ? intervalMinutes(nextOpeningRequirement.window.start, nextOpeningRequirement.window.end) ?? 0 : 0
  const nextEarlyDeficit = nextOpeningRequirement ? nextOpeningDeficit * (24 * 60 - timeToMinutes(nextOpeningRequirement.window.start)!) : 0
  return [uncovered + nextOpeningDeficit, deficitMinutes + nextOpeningDeficit * nextOpeningMinutes, closingDeficit, earlyDeficit + nextEarlyDeficit, extraClosers, surplus, scarcity, fairness]
}

function compareNumberArrays(left: readonly number[], right: readonly number[]) { for (let index = 0; index < Math.max(left.length, right.length); index++) { const difference = (left[index] ?? 0) - (right[index] ?? 0); if (difference) return difference } return 0 }
function endsAtStoreClosing(context: GenerationContext, shift: Shift) { const day = storeDay(context, shift.date); return !!day?.closesAt && shift.segments.at(-1)!.endTime === day.closesAt }
function mustReserveOpening(state: PipelineState, employeeId: EmployeeId, date: string) { const maximum = state.context.employeeConstraints.find((constraint) => constraint.employeeId === employeeId && constraint.type === "MAX_OPENINGS")?.value; if (maximum == null) return false; const used = state.assignments.filter((assignment) => assignment.employeeId === employeeId).map((assignment) => shiftFor(state, assignment.shiftId)).filter((shift): shift is Shift => !!shift && shift.segments[0].startTime === storeDay(state.context, shift.date)?.opensAt).length; if (maximum - used > 1) return false; for (const futureDate of dates(addDays(date, 1), state.context.settings.period.end)) { const opening = state.requirements.filter((requirement) => requirement.window.date === futureDate && isOpening(state.context, requirement)).sort((a, b) => b.minEmployees - a.minEmployees)[0]; if (!opening) continue; const eligible = state.allocation!.rows.filter((row) => (row.minutesByDate[futureDate] ?? 0) > 0).map((row) => state.context.employees.find((employee) => employee.id === row.employeeId)!).filter((employee) => employee.capabilities.includes("CAN_OPEN")); if (eligible.length <= opening.minEmployees && eligible.some((employee) => employee.id === employeeId)) return true } return false }
function mustReserveClosing(state: PipelineState, employeeId: EmployeeId, date: string) { const employee = state.context.employees.find((item) => item.id === employeeId)!, maximum = state.context.employeeConstraints.find((constraint) => constraint.employeeId === employeeId && constraint.type === "MAX_CLOSINGS")?.value; if (maximum == null || employee.capabilities.includes("CAN_OPEN")) return false; const used = state.assignments.filter((assignment) => assignment.employeeId === employeeId).map((assignment) => shiftFor(state, assignment.shiftId)).filter((shift): shift is Shift => !!shift && endsAtStoreClosing(state.context, shift)).length, remainingClosings = maximum - used; for (const futureDate of dates(addDays(date, 1), state.context.settings.period.end)) { const opening = state.requirements.filter((requirement) => requirement.window.date === futureDate && isOpening(state.context, requirement)).sort((a, b) => b.minEmployees - a.minEmployees)[0], closing = state.requirements.some((requirement) => requirement.window.date === futureDate && isClosing(state.context, requirement) && requirement.minEmployees > 0); if (!opening || !closing || (state.allocation!.rows.find((row) => row.employeeId === employeeId)?.minutesByDate[futureDate] ?? 0) <= 0) continue; const openers = state.allocation!.rows.filter((row) => (row.minutesByDate[futureDate] ?? 0) > 0).map((row) => state.context.employees.find((candidate) => candidate.id === row.employeeId)!).filter((candidate) => candidate.capabilities.includes("CAN_OPEN")), daysUntil = (Date.parse(`${futureDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000, requiredReserve = daysUntil > 1 ? 2 : 1; if (openers.length <= opening.minEmployees && remainingClosings <= requiredReserve) return true } return false }
function minimumCoverageMinutes(state: PipelineState) { return state.requirements.reduce((sum, requirement) => sum + requirement.minEmployees * (intervalMinutes(requirement.window.start, requirement.window.end, requirement.window.endDayOffset) ?? 0), 0) }
function sectorContractMinutes(state: PipelineState) { const sectors = (state.context.business.sectors ?? []).filter((sector) => sector.active); if (sectors.length !== 1) return activeEmployees(state).reduce((sum, employee) => { const contract = state.context.contracts.find((item) => item.employeeId === employee.id); return sum + (contract ? contractualMinutes(contract) : 0) }, 0); const ids = new Set(sectors[0].assignedEmployeeIds); return activeEmployees(state).filter((employee) => ids.has(employee.id)).reduce((sum, employee) => { const contract = state.context.contracts.find((item) => item.employeeId === employee.id); return sum + (contract ? contractualMinutes(contract) : 0) }, 0) }
function structuralSurplusMinutes(state: PipelineState) { return Math.max(0, sectorContractMinutes(state) - minimumCoverageMinutes(state)) }
function distributionMetrics(state: PipelineState, shifts: readonly Shift[], assignments: readonly Assignment[]) {
  const shiftMap = new Map(shifts.map((shift) => [shift.id, shift]))
  return (state.context.business.sectors ?? []).filter((sector) => sector.active).flatMap((sector) => {
    const employeeIds = new Set(sector.assignedEmployeeIds), total = activeEmployees(state).filter((employee) => employeeIds.has(employee.id)).reduce((sum, employee) => { const contract = state.context.contracts.find((item) => item.employeeId === employee.id); return sum + (contract ? contractualMinutes(contract) : 0) }, 0)
    let targets: ReturnType<typeof allocateDailyContractMinutes>
    try { targets = allocateDailyContractMinutes(total, sector.weeklyDistribution, state.context.settings.timeIncrementMinutes ?? 15) } catch { return [] }
    return targets.map((target) => {
      const actualMinutes = assignments.filter((assignment) => employeeIds.has(assignment.employeeId)).reduce((sum, assignment) => { const shift = shiftMap.get(assignment.shiftId); return sum + (shift && weekDayOf(shift.date) === target.day ? shiftDuration(shift) : 0) }, 0)
      return { sectorName: sector.name, day: target.day, targetMinutes: target.targetMinutes, actualMinutes, errorMinutes: Math.abs(actualMinutes - target.targetMinutes) }
    })
  })
}

type RepairFamily = "coordinated-portions" | "reassign-complete-shift" | "resize-coherent-shift" | "move-start-or-end" | "move-complete-shift-between-days" | "exchange-complete-shifts" | "reshape-authorised-split" | "merge-compatible-shifts"
interface RepairCandidate { readonly family: RepairFamily; readonly shifts: Shift[]; readonly assignments: Assignment[]; readonly reason: string }
interface RepairNode extends RepairCandidate { readonly objective: WeeklyObjective; readonly hash: string; readonly reasons: readonly string[] }

function searchWeeklyRepairs(state: PipelineState) {
  const initialObjective = weeklyObjective(state, state.shifts, state.assignments)
  const initial: RepairNode = { family: "coordinated-portions", shifts: [...state.shifts], assignments: [...state.assignments], reason: "État initial", reasons: [], objective: initialObjective, hash: repairStateHash(state.shifts, state.assignments) }
  if (initialObjective.every((value) => value === 0)) return { shifts: initial.shifts, assignments: initial.assignments, reasons: initial.reasons }
  const seen = new Set([initial.hash])
  let frontier: RepairNode[] = [initial], best = initial, evaluations = 0
  const maximumEvaluations = state.context.business.sectors?.some((sector) => sector.active) ? 256 : 48, maximumDepth = 12, beamWidth = 10
  for (let depth = 0; depth < maximumDepth && frontier.length && evaluations < maximumEvaluations; depth++) {
    const next: RepairNode[] = []
    for (const node of frontier) {
      const originalShifts = state.shifts, originalAssignments = state.assignments
      state.shifts = [...node.shifts]; state.assignments = [...node.assignments]
      const candidates = generateRepairCandidates(state)
      state.shifts = originalShifts; state.assignments = originalAssignments
      for (const candidate of candidates) {
        const statistics = repairStatistics(state, candidate.family); statistics.generated++
        const hash = repairStateHash(candidate.shifts, candidate.assignments)
        if (seen.has(hash)) { statistics.rejected++; continue }
        seen.add(hash)
        const objective = weeklyObjective(state, candidate.shifts, candidate.assignments)
        statistics.evaluated++; evaluations++
        if (compareObjective(objective, node.objective) > 0) { statistics.rejected++; continue }
        next.push({ ...candidate, objective, hash, reasons: [...node.reasons, candidate.reason] })
        if (evaluations >= maximumEvaluations) break
      }
      if (evaluations >= maximumEvaluations) break
    }
    next.sort((left, right) => compareObjective(left.objective, right.objective) || left.hash.localeCompare(right.hash))
    frontier = next.slice(0, beamWidth)
    const retained = new Set(frontier.map((node) => node.hash))
    for (const node of next) if (!retained.has(node.hash)) repairStatistics(state, node.family).rejected++
    for (const node of frontier) repairStatistics(state, node.family).accepted++
    if (frontier[0] && compareObjective(frontier[0].objective, best.objective) < 0) best = frontier[0]
    if (best.objective.every((value) => value === 0)) break
  }
  return { shifts: best.shifts, assignments: best.assignments, reasons: best.reasons }
}

function repairStatistics(state: PipelineState, family: RepairFamily) {
  let statistics = state.repairAttempts.get(family)
  if (!statistics) { statistics = { family, generated: 0, rejected: 0, evaluated: 0, accepted: 0 }; state.repairAttempts.set(family, statistics) }
  return statistics
}

function generateRepairCandidates(state: PipelineState): RepairCandidate[] {
  const candidates: RepairCandidate[] = [], employees = activeEmployees(state)
  const over = employees.filter((item) => contractRemaining(state, item.id) < 0), under = employees.filter((item) => contractRemaining(state, item.id) > 0)
  for (let variant = 0; variant < 4; variant++) {
    const coordinated = coordinatedContractRepair(state, variant)
    if (coordinated) candidates.push(coordinated)
  }
  for (const donor of over) for (const receiver of under) {
    for (const assignment of state.assignments.filter((item) => item.employeeId === donor.id).slice(0, 4)) {
      const shift = shiftFor(state, assignment.shiftId)
      if (!shift || shiftDuration(shift) > contractRemaining(state, receiver.id)) continue
      candidates.push({ family: "reassign-complete-shift", ...reassignCompleteShift(state, assignment, receiver), reason: `Shift complet transféré de ${donor.firstName} vers ${receiver.firstName}` })
    }
    for (const donorShift of employeeShifts(state, donor.id).slice(0, 3)) for (const receiverShift of employeeShifts(state, receiver.id).slice(0, 3)) for (const edge of ["start", "end"] as const) {
      const shortened = resizeShift(donorShift, edge, -15), extended = resizeShift(receiverShift, edge, 15)
      if (shortened && extended) candidates.push({ family: "coordinated-portions", shifts: replaceShifts(state.shifts, shortened, extended), assignments: [...state.assignments], reason: `Portions coordonnées transférées de ${donor.firstName} vers ${receiver.firstName}` })
    }
  }
  for (const employee of under) for (const shift of employeeShifts(state, employee.id).slice(0, 6)) for (const edge of ["start", "end"] as const) {
    const resized = resizeShift(shift, edge, 15)
    if (resized) candidates.push({ family: edge === "start" ? "move-start-or-end" : "resize-coherent-shift", shifts: replaceShifts(state.shifts, resized), assignments: [...state.assignments], reason: `Shift de ${employee.firstName} étendu de 15 minutes` })
  }
  for (const employee of over) for (const shift of employeeShifts(state, employee.id).slice(0, 6)) for (const edge of ["start", "end"] as const) {
    const resized = resizeShift(shift, edge, -15)
    if (resized) candidates.push({ family: edge === "start" ? "move-start-or-end" : "resize-coherent-shift", shifts: replaceShifts(state.shifts, resized), assignments: [...state.assignments], reason: `Shift de ${employee.firstName} raccourci de 15 minutes` })
  }
  for (let leftIndex = 0; leftIndex < employees.length; leftIndex++) for (let rightIndex = leftIndex + 1; rightIndex < employees.length; rightIndex++) {
    const left = employees[leftIndex], right = employees[rightIndex], leftAssignment = state.assignments.find((item) => item.employeeId === left.id), rightAssignment = state.assignments.find((item) => item.employeeId === right.id)
    if (leftAssignment && rightAssignment) candidates.push({ family: "exchange-complete-shifts", ...exchangeCompleteShifts(state, leftAssignment, right, rightAssignment, left), reason: `Shifts complets échangés entre ${left.firstName} et ${right.firstName}` })
  }
  for (const employee of employees) for (const shift of employeeShifts(state, employee.id).slice(0, 2)) {
    const contract = state.context.contracts.find((item) => item.employeeId === employee.id)
    for (const date of dates(state.context.settings.period.start, state.context.settings.period.end).filter((item) => item !== shift.date && contract?.workingDays.includes(weekDayOf(item)) && !employeeShifts(state, employee.id).some((owned) => owned.date === item))) candidates.push({ family: "move-complete-shift-between-days", shifts: replaceShifts(state.shifts, { ...shift, date }), assignments: [...state.assignments], reason: `Journée complète de ${employee.firstName} déplacée du ${shift.date} au ${date}` })
  }
  for (const employee of employees) for (const date of dates(state.context.settings.period.start, state.context.settings.period.end)) {
    const entries = state.assignments.filter((assignment) => assignment.employeeId === employee.id).map((assignment) => ({ assignment, shift: shiftFor(state, assignment.shiftId) })).filter((entry): entry is { assignment: Assignment; shift: Shift } => !!entry.shift && entry.shift.date === date).sort((a, b) => a.shift.segments[0].startTime.localeCompare(b.shift.segments[0].startTime))
    if (entries.length !== 2) continue
    const [first, second] = entries, merged = mergeShift(first.shift, second.shift)
    if (gapBetween(first.shift, second.shift) <= 15 && shiftDuration(merged) <= (state.context.settings.maximumDailyMinutes ?? 600)) candidates.push({ family: "merge-compatible-shifts", shifts: replaceShifts(state.shifts, merged).filter((shift) => shift.id !== second.shift.id), assignments: state.assignments.filter((assignment) => assignment.id !== second.assignment.id), reason: `Shifts compatibles de ${employee.firstName} fusionnés le ${date}` })
    const requirement = state.requirements.find((item) => item.window.date === date && coversRequirement(second.shift, item))
    if (requirement && splitPermitted(state, employee, requirement, first.shift, second.shift)) {
      const shortened = resizeShift(first.shift, "end", -15), extended = resizeShift(second.shift, "start", 15)
      if (shortened && extended && shiftDuration(shortened) >= minimumShiftFor(state, employee.id)) candidates.push({ family: "reshape-authorised-split", shifts: replaceShifts(state.shifts, shortened, extended), assignments: [...state.assignments], reason: `Coupure autorisée de ${employee.firstName} remodelée le ${date}` })
    }
  }
  return candidates.sort((left, right) => left.family.localeCompare(right.family) || left.reason.localeCompare(right.reason)).slice(0, 96)
}

function coordinatedContractRepair(state: PipelineState, variant: number): RepairCandidate | null {
  let shifts = state.shifts.map((shift) => ({ ...shift, segments: shift.segments.map((segment) => ({ ...segment })) }))
  const assignments = [...state.assignments]
  const employees = activeEmployees(state).filter((employee) => contractRemaining(state, employee.id) !== 0)
  for (const employee of employees) {
    const originalDifference = contractRemaining(state, employee.id), amount = Math.abs(originalDifference)
    if (amount % 15 !== 0) return null
    for (let moved = 0; moved < amount; moved += 15) {
      const ids = new Set(assignments.filter((assignment) => assignment.employeeId === employee.id).map((assignment) => assignment.shiftId))
      const owned = shifts.filter((shift) => ids.has(shift.id)).sort((a, b) => `${a.date}|${a.segments[0].startTime}|${a.id}`.localeCompare(`${b.date}|${b.segments[0].startTime}|${b.id}`))
      if (variant & 1) owned.reverse()
      const edges = (variant & 2 ? ["end", "start"] : ["start", "end"]) as readonly ("start" | "end")[]
      let chosen: Shift[] | null = null, leastViolations = Number.POSITIVE_INFINITY
      for (const shift of owned) for (const edge of edges) {
        const resized = resizeShift(shift, edge, originalDifference > 0 ? 15 : -15)
        if (!resized || shiftDuration(resized) < minimumShiftFor(state, employee.id)) continue
        const proposal = replaceShifts(shifts, resized)
        const violations = validateCandidatePlan(state.context, state.requirements, proposal, assignments).length
        if (violations < leastViolations) { leastViolations = violations; chosen = proposal }
        if (violations === 0) break
      }
      if (!chosen) return null
      shifts = chosen
    }
  }
  return { family: "coordinated-portions", shifts, assignments, reason: "Redistribution contractuelle composée appliquée en une mutation hebdomadaire atomique" }
}

type WeeklyObjective = readonly [number, number, number, number, number, number, number, number, number]
function weeklyObjective(state: PipelineState, shifts: readonly Shift[], assignments: readonly Assignment[]): WeeklyObjective {
  const originalShifts = state.shifts, originalAssignments = state.assignments
  state.shifts = [...shifts]; state.assignments = [...assignments]
  const deltas = activeEmployees(state).map((employee) => Math.abs(contractRemaining(state, employee.id)))
  const blocking = validateCandidatePlan(state.context, state.requirements, shifts, assignments).length
  let uncovered = 0, deficitMinutes = 0, surplusMinutes = 0, extraClosers = 0
  for (const requirement of state.requirements) {
    const assigned = assignedFor(state, requirement).length, duration = intervalMinutes(requirement.window.start, requirement.window.end) ?? 0
    if (assigned < requirement.minEmployees) { uncovered++; deficitMinutes += (requirement.minEmployees - assigned) * duration }
    if (assigned > requirement.minEmployees) surplusMinutes += (assigned - requirement.minEmployees) * duration
    if (isClosing(state.context, requirement)) extraClosers += Math.max(0, assigned - requirement.minEmployees)
  }
  const distributionError = distributionMetrics(state, shifts, assignments).reduce((sum, metric) => sum + metric.errorMinutes, 0)
  const closingLoads = activeEmployees(state).map((employee) => state.requirements.filter((requirement) => isClosing(state.context, requirement) && assignedFor(state, requirement).some((assignment) => assignment.employeeId === employee.id)).length)
  const preferencePenalty = (state.context.business.employeePreferences ?? []).filter((preference) => preference.prefersClosing && !state.requirements.some((requirement) => isClosing(state.context, requirement) && assignedFor(state, requirement).some((assignment) => assignment.employeeId === preference.employeeId))).length
  const fairness = (closingLoads.length ? Math.max(...closingLoads) - Math.min(...closingLoads) : 0) + preferencePenalty
  state.shifts = originalShifts; state.assignments = originalAssignments
  return [blocking, deltas.filter(Boolean).length, deltas.reduce((sum, value) => sum + value, 0), uncovered, deficitMinutes, extraClosers, Math.max(0, surplusMinutes - structuralSurplusMinutes(state)), distributionError, fairness]
}
function compareObjective(left: WeeklyObjective, right: WeeklyObjective) { for (let index = 0; index < left.length; index++) { if (left[index] !== right[index]) return left[index] - right[index] } return 0 }
function employeeShifts(state: PipelineState, employeeId: EmployeeId) { return state.assignments.filter((item) => item.employeeId === employeeId).map((item) => shiftFor(state, item.shiftId)).filter((item): item is Shift => !!item).sort((a, b) => `${a.date}|${a.segments[0].startTime}|${a.id}`.localeCompare(`${b.date}|${b.segments[0].startTime}|${b.id}`)) }
function replaceShifts(shifts: readonly Shift[], ...replacements: Shift[]) { const byId = new Map(replacements.map((item) => [item.id, item])); return shifts.map((item) => byId.get(item.id) ?? item) }
function reassignCompleteShift(state: PipelineState, assignment: Assignment, employee: Employee) {
  const current = shiftFor(state, assignment.shiftId)!, shift = rekeyShift(current, employee.id, String(assignment.id))
  const nextAssignment = buildAssignment(state.context.planning, shift, employee, state.context.settings)
  return { shifts: state.shifts.map((item) => item.id === current.id ? shift : item), assignments: state.assignments.map((item) => item.id === assignment.id ? nextAssignment : item) }
}
function exchangeCompleteShifts(state: PipelineState, leftAssignment: Assignment, rightEmployee: Employee, rightAssignment: Assignment, leftEmployee: Employee) {
  const left = shiftFor(state, leftAssignment.shiftId)!, right = shiftFor(state, rightAssignment.shiftId)!
  const nextLeft = rekeyShift(left, rightEmployee.id, String(leftAssignment.id)), nextRight = rekeyShift(right, leftEmployee.id, String(rightAssignment.id))
  const leftReplacement = buildAssignment(state.context.planning, nextLeft, rightEmployee, state.context.settings), rightReplacement = buildAssignment(state.context.planning, nextRight, leftEmployee, state.context.settings)
  return { shifts: state.shifts.map((item) => item.id === left.id ? nextLeft : item.id === right.id ? nextRight : item), assignments: state.assignments.map((item) => item.id === leftAssignment.id ? leftReplacement : item.id === rightAssignment.id ? rightReplacement : item) }
}
function rekeyShift(shift: Shift, employeeId: EmployeeId, identity: string): Shift { return { ...shift, id: `shift_${employeeId}_${shift.date}_repair_${identity}` as ShiftId, segments: shift.segments.map((segment) => ({ ...segment })) } }
function resizeShift(shift: Shift, edge: "start" | "end", amount: number): Shift | null { const segment = shift.segments[0], start = timeToMinutes(segment.startTime)!, end = timeToMinutes(segment.endTime)!; const nextStart = edge === "start" ? start - amount : start, nextEnd = edge === "end" ? end + amount : end; if (nextStart < 0 || nextEnd > 24 * 60 || nextStart >= nextEnd) return null; return { ...shift, segments: [{ ...segment, startTime: toTime(nextStart), endTime: toTime(nextEnd) }] } }
function repairStateHash(shifts: readonly Shift[], assignments: readonly Assignment[]) { const shiftPart = [...shifts].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((shift) => `${shift.id}:${shift.date}:${shift.segments.map((segment) => `${segment.startTime}-${segment.endTime}-${segment.endDayOffset ?? 0}`).join(",")}`).join("|"); const assignmentPart = [...assignments].sort((a, b) => String(a.id).localeCompare(String(b.id))).map((assignment) => `${assignment.id}:${assignment.shiftId}:${assignment.employeeId}`).join("|"); return `${shiftPart}#${assignmentPart}` }
