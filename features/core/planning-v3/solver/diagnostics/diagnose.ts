import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningInfeasibilityV3 } from "@/features/core/planning-v3/types/validation"
import type { CandidateSpaceV3 } from "@/features/core/planning-v3/solver/candidate-generator/generate-candidates"
import type { SolverModelV3 } from "@/features/core/planning-v3/solver/daily-patterns/day-model"

/**
 * Structural reasons a problem admits no schedule, found before searching.
 *
 * These are all NECESSARY conditions: if one fails, no assignment can exist, so
 * reporting infeasibility is sound. They are not sufficient — a problem that
 * passes every check here can still turn out infeasible, which the search then
 * proves by exhausting the space.
 *
 * The point is a usable answer. "Aucun planning possible" tells an operator
 * nothing; "mardi demande 1 650 minutes mais les salariés disponibles n'en
 * offrent au plus que 1 500" tells them what to change.
 */
export function diagnoseInfeasibility(
  problem: PlanningProblemV3,
  space: CandidateSpaceV3,
  model: SolverModelV3
): PlanningInfeasibilityV3[] {
  const reasons: PlanningInfeasibilityV3[] = []

  for (const [dayIndex, day] of model.days.entries()) {
    const problemDay = problem.days[dayIndex]
    if (problemDay.closed) continue

    if (day.budgetMinutes < day.minimumSuffix[0]) {
      reasons.push({
        code: "daily_budget_below_mandatory_minimum",
        date: day.date,
        message: `Le ${day.date} dispose d'un budget de ${day.budgetMinutes} minutes, mais les jours obligatoires imposent au moins ${day.minimumSuffix[0]} minutes.`,
      })
    }
    if (day.budgetMinutes > day.maximumSuffix[0]) {
      reasons.push({
        code: "daily_budget_above_capacity",
        date: day.date,
        message: `Le ${day.date} demande ${day.budgetMinutes} minutes, mais les salariés disponibles n'en offrent au plus que ${day.maximumSuffix[0]}.`,
      })
    }
    if (day.openersSuffix[0] < day.requiredMinimumOpenings) {
      reasons.push({
        code: "no_eligible_opener",
        date: day.date,
        message: `Le ${day.date} exige ${day.requiredMinimumOpenings} ouverture(s), mais seuls ${day.openersSuffix[0]} salarié(s) peuvent ouvrir ce jour-là.`,
      })
    }
    if (day.closersSuffix[0] < day.requiredExactClosings) {
      reasons.push({
        code: "no_eligible_closer",
        date: day.date,
        message: `Le ${day.date} exige ${day.requiredExactClosings} fermeture(s), mais seuls ${day.closersSuffix[0]} salarié(s) peuvent fermer ce jour-là.`,
      })
    }

    for (const [employeeIndex, employee] of problem.employees.entries()) {
      if (space.days[dayIndex].byEmployee[employeeIndex].length === 0) {
        reasons.push({
          code: "no_candidate_for_mandatory_day",
          employeeId: employee.id,
          date: day.date,
          message: `${employee.firstName} ${employee.lastName} doit travailler le ${day.date} mais aucun shift légal n'existe pour lui ce jour-là.`,
        })
      }
    }
  }

  for (const [employeeIndex, employee] of problem.employees.entries()) {
    const minimum = model.weeklyMinimum[employeeIndex][0]
    const maximum = model.weeklyMaximum[employeeIndex][0]
    if (employee.contractMinutes < minimum) {
      reasons.push({
        code: "contract_below_mandatory_minimum",
        employeeId: employee.id,
        message: `${employee.firstName} ${employee.lastName} a un contrat de ${employee.contractMinutes} minutes, mais ses jours obligatoires en imposent au moins ${minimum}.`,
      })
    }
    if (employee.contractMinutes > maximum) {
      reasons.push({
        code: "contract_above_capacity",
        employeeId: employee.id,
        message: `${employee.firstName} ${employee.lastName} a un contrat de ${employee.contractMinutes} minutes, mais ses jours disponibles n'en offrent au plus que ${maximum}.`,
      })
    }
  }

  const totalContract = problem.employees.reduce((sum, e) => sum + e.contractMinutes, 0)
  const totalBudget = problem.days.reduce((sum, day) => sum + day.budgetMinutes, 0)
  if (totalContract !== totalBudget) {
    reasons.push({
      code: "budget_contract_mismatch",
      message: `Les budgets journaliers totalisent ${totalBudget} minutes pour ${totalContract} minutes contractuelles : aucune répartition exacte n'est possible.`,
    })
  }

  return reasons
}
