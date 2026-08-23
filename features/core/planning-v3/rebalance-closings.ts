import type { EmployeeId, IsoDate } from "@/features/core/models"
import {
  closingLoadSpreadPermille,
  loadsAfterWeek,
  weeklyClosingShare,
} from "@/features/core/planning-v3/fairness/closing-load"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type {
  PlanningAssignmentV3,
  PlanningSolutionV3,
} from "@/features/core/planning-v3/types/solution"
import { validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

/**
 * Rééquilibrer les fermetures APRÈS le placement, sans rien casser.
 *
 * L'équité est une préférence classée sous la couverture et sous le placement
 * des heures contractuelles. Une fois ces heures posées, il ne reste presque
 * plus de liberté : mesuré sur une équipe aux contrats inégaux, la balance ne
 * déplaçait qu'une fermeture là où elle en déplaçait deux à contrats égaux. Le
 * gérant voyait donc ses plus chargés fermer encore, avec des collègues plus
 * légers disponibles le même soir.
 *
 * Ce module reprend la main là où le solveur s'arrête, et il repose sur une
 * propriété exacte :
 *
 *   **Échanger les créneaux de deux personnes le MÊME JOUR ne change pas la
 *   couverture.** Les mêmes créneaux restent travaillés, aux mêmes heures ;
 *   seule l'identité de qui les tient change. Aucune minute n'apparaît, aucune
 *   ne disparaît.
 *
 * Et si les deux créneaux ont la MÊME DURÉE, le total hebdomadaire de chacun est
 * préservé à la minute — donc aucun contrat ne bouge non plus.
 *
 * Tout le reste — repos entre deux jours, plafonds d'ouvertures et de
 * fermetures, compétences, amplitudes, rayons autorisés — n'est pas revérifié à
 * la main ici : **le validateur le fait déjà**, et il le fait mieux. Chaque
 * échange est donc proposé, soumis au validateur, et retenu SEULEMENT s'il ne
 * dégrade rien. Un rééquilibrage ne peut pas rendre un planning pire que celui
 * qu'il a reçu ; au pire il ne change rien.
 */

/** Un échange retenu, pour que le rapport puisse le dire. */
export interface ClosingSwap {
  readonly date: IsoDate
  readonly from: EmployeeId
  readonly to: EmployeeId
}

export interface ClosingRebalance {
  readonly solution: PlanningSolutionV3
  readonly swaps: readonly ClosingSwap[]
  /** L'écart d'équité avant et après, en pour mille. */
  readonly spreadBefore: number
  readonly spreadAfter: number
}

/**
 * Combien de passes au maximum.
 *
 * Chaque passe retient au plus un échange, et un échange ne peut que réduire
 * l'écart — la suite est donc strictement décroissante et s'arrête d'elle-même.
 * La borne existe pour qu'un défaut de comparaison ne puisse pas produire une
 * boucle infinie dans un serveur, pas parce qu'on l'attend.
 */
const MAX_PASSES = 12

function totalMinutes(assignment: PlanningAssignmentV3): number {
  return assignment.segments.reduce(
    (sum, segment) => sum + (segment.endMinutes - segment.startMinutes),
    0
  )
}

/** Qui termine exactement à l'heure de fermeture, ce jour-là. */
function closerOf(
  problem: PlanningProblemV3,
  assignments: readonly PlanningAssignmentV3[],
  date: IsoDate
): PlanningAssignmentV3 | null {
  const day = problem.days.find((entry) => entry.date === date)
  if (!day || day.closed || day.closesAtMinutes === null) return null
  for (const assignment of assignments) {
    if (assignment.date !== date || assignment.segments.length === 0) continue
    const last = assignment.segments[assignment.segments.length - 1]
    if (last.endMinutes === day.closesAtMinutes) return assignment
  }
  return null
}

/** Les fermetures de la semaine, par salarié. */
function closingsByEmployee(
  problem: PlanningProblemV3,
  assignments: readonly PlanningAssignmentV3[]
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const day of problem.days) {
    const closer = closerOf(problem, assignments, day.date)
    if (!closer) continue
    const id = String(closer.employeeId)
    counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

/**
 * L'écart d'équité de cette semaine, en pour mille.
 *
 * Le dénominateur ne dépend PAS de qui ferme — un échange ne change ni les
 * disponibilités ni les contrats — donc il est calculé une fois et réutilisé.
 * Seuls les compteurs de fermetures bougent d'un échange à l'autre.
 */
function spreadOf(
  problem: PlanningProblemV3,
  assignments: readonly PlanningAssignmentV3[],
  opportunities: Readonly<Record<string, number>>,
  closerIds: readonly EmployeeId[]
): number {
  return closingLoadSpreadPermille(
    loadsAfterWeek(
      problem.closingHistory ?? [],
      closingsByEmployee(problem, assignments),
      opportunities,
      closerIds
    )
  )
}

/** La solution où deux personnes ont échangé leurs journées, sur ces dates. */
function exchanged(
  solution: PlanningSolutionV3,
  dates: readonly IsoDate[],
  left: EmployeeId,
  right: EmployeeId
): PlanningSolutionV3 {
  const swapped = new Set<string>(dates)
  return {
    ...solution,
    assignments: solution.assignments.map((assignment) => {
      if (!swapped.has(assignment.date)) return assignment
      if (String(assignment.employeeId) === String(left)) return { ...assignment, employeeId: right }
      if (String(assignment.employeeId) === String(right)) return { ...assignment, employeeId: left }
      return assignment
    }),
  }
}

/** Ce que cette personne travaille ce jour-là, en minutes. Zéro si elle est absente. */
function minutesOn(
  assignments: readonly PlanningAssignmentV3[],
  employeeId: EmployeeId,
  date: IsoDate
): number {
  const found = assignments.find(
    (assignment) => assignment.date === date && String(assignment.employeeId) === String(employeeId)
  )
  return found ? totalMinutes(found) : 0
}

export function rebalanceClosings(
  problem: PlanningProblemV3,
  solution: PlanningSolutionV3
): ClosingRebalance {
  const fairness = problem.rules.closingFairness
  const unchanged = (spread: number): ClosingRebalance => ({
    solution,
    swaps: [],
    spreadBefore: spread,
    spreadAfter: spread,
  })

  if (!fairness || (!fairness.balanceClosings && !fairness.balanceSaturdayClosings)) {
    return unchanged(0)
  }

  const closers = problem.employees.filter((employee) => employee.canClose)
  if (closers.length < 2) return unchanged(0)
  const closerIds = closers.map((employee) => employee.id)

  // La part de la semaine, identique avant et après tout échange.
  const opportunities: Record<string, number> = {}
  for (const employee of closers) {
    opportunities[String(employee.id)] = weeklyClosingShare(employee.workingDays.length)
  }

  const before = spreadOf(problem, solution.assignments, opportunities, closerIds)

  // Un planning déjà en faute ne se rééquilibre pas : on ne bâtit rien sur une
  // base invalide, et le gérant a d'abord une violation à lire.
  const baseline = validatePlanningSolutionV3(problem, solution)
  if (!baseline.validHardConstraints) return unchanged(before)

  let current = solution
  let spread = before
  const swaps: ClosingSwap[] = []

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let improvement: { solution: PlanningSolutionV3; swap: ClosingSwap; spread: number } | null = null

    for (const day of problem.days) {
      if (day.closed || day.closesAtMinutes === null) continue
      const closer = closerOf(problem, current.assignments, day.date)
      if (!closer) continue
      const closerMinutes = totalMinutes(closer)

      for (const other of current.assignments) {
        if (other.date !== day.date) continue
        if (String(other.employeeId) === String(closer.employeeId)) continue

        // Les heures hebdomadaires sont une contrainte DURE, exacte à la minute.
        // Un échange doit donc rendre à chacun exactement son total.
        //
        // Durées égales ce jour-là : la journée seule suffit. Sinon il faut une
        // SECONDE journée qui compense l'écart en sens inverse — l'échange 2×2.
        // Sans lui, deux contrats différents ne s'échangent jamais, et c'est
        // précisément la situation où l'équité manquait le plus de liberté.
        const gap = closerMinutes - totalMinutes(other)
        const dates: IsoDate[] = [day.date]
        if (gap !== 0) {
          const compensating = problem.days.find((second) => {
            if (second.date === day.date || second.closed) return false
            const mine = minutesOn(current.assignments, closer.employeeId, second.date)
            const theirs = minutesOn(current.assignments, other.employeeId, second.date)
            // Une journée où l'un ou l'autre ne travaille pas déplacerait un
            // jour de repos, pas des heures : on ne la retient pas.
            if (mine === 0 || theirs === 0) return false
            return mine - theirs === -gap
          })
          if (!compensating) continue
          dates.push(compensating.date)
        }

        const candidate = exchanged(current, dates, closer.employeeId, other.employeeId)
        const candidateSpread = spreadOf(problem, candidate.assignments, opportunities, closerIds)
        if (candidateSpread >= spread) continue

        // Le validateur tranche. Un échange qui introduirait la moindre
        // violation, ou qui coûterait une seule minute de couverture, est
        // abandonné : l'équité ne s'achète pas au prix de la légalité.
        const report = validatePlanningSolutionV3(problem, candidate)
        if (!report.validHardConstraints) continue
        if (report.underCoveredSlots > baseline.underCoveredSlots) continue
        if (report.metrics.totalDeficitMinutes > baseline.metrics.totalDeficitMinutes) continue
        if (report.degradations.length > baseline.degradations.length) continue

        if (improvement === null || candidateSpread < improvement.spread) {
          improvement = {
            solution: candidate,
            swap: { date: day.date, from: closer.employeeId, to: other.employeeId },
            spread: candidateSpread,
          }
        }
      }
    }

    if (improvement === null) break
    current = improvement.solution
    spread = improvement.spread
    swaps.push(improvement.swap)
  }

  return { solution: current, swaps, spreadBefore: before, spreadAfter: spread }
}
