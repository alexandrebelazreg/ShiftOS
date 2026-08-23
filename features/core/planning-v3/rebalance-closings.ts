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

/**
 * Combien de jours au plus avant de renoncer à l'exploration exhaustive.
 *
 * Le nombre de combinaisons double à chaque jour ajouté. Une période de
 * génération en compte sept, donc cent vingt-sept combinaisons — négligeable.
 * La borne protège d'une période inhabituellement longue, pas du cas courant.
 */
const MAX_DAYS_FOR_SUBSETS = 14

/**
 * Les groupes de jours dont l'échange conserve les DEUX totaux hebdomadaires.
 *
 * Un échange ne préserve un contrat que si les durées échangées se compensent
 * exactement. Chercher une seule journée de compensation ne suffisait pas :
 * quand deux salariés ont le même contrat hebdomadaire, leurs écarts
 * quotidiens s'annulent sur la SEMAINE, rarement sur une paire de jours.
 * C'est ce qui faisait échouer tous les échanges dans une équipe pourtant
 * homogène — et à la limite, échanger la semaine entière conserve les totaux
 * par construction.
 *
 * Les groupes sont rendus du plus petit au plus grand : à équité égale, le
 * planning qui bouge le moins est celui que le gérant reconnaît.
 */
function balancedSubsets(
  deltas: readonly number[],
  anchor: number,
  exhaustive: boolean
): number[][] {
  const found: number[][] = []
  const limit = exhaustive ? deltas.length : Math.min(deltas.length, 2)

  for (let size = 1; size <= limit; size += 1) {
    const current: number[] = []
    const walk = (start: number, sum: number) => {
      if (current.length === size) {
        // Le jour de la fermeture DOIT être du voyage, sinon l'échange ne
        // déplace pas la fermeture qu'on cherche à déplacer.
        if (sum === 0 && current.includes(anchor)) found.push([...current])
        return
      }
      for (let index = start; index < deltas.length; index += 1) {
        current.push(index)
        walk(index + 1, sum + deltas[index])
        current.pop()
      }
    }
    walk(0, 0)
    if (found.length > 0) return found
  }
  return found
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

    const openDays = problem.days.filter((day) => !day.closed && day.closesAtMinutes !== null)
    // Au-delà de deux semaines, on renonce à l'exploration exhaustive : elle
    // double à chaque jour ajouté. Une période de génération en fait sept.
    const exhaustive = openDays.length <= MAX_DAYS_FOR_SUBSETS

    for (const day of openDays) {
      const closer = closerOf(problem, current.assignments, day.date)
      if (!closer) continue

      for (const partner of problem.employees) {
        if (String(partner.id) === String(closer.employeeId)) continue

        // L'écart de durée, jour par jour. Un jour non travaillé compte zéro :
        // l'échanger déplace un repos, ce que le validateur jugera.
        const deltas = openDays.map(
          (entry) =>
            minutesOn(current.assignments, closer.employeeId, entry.date) -
            minutesOn(current.assignments, partner.id, entry.date)
        )
        const anchor = openDays.findIndex((entry) => entry.date === day.date)

        for (const subset of balancedSubsets(deltas, anchor, exhaustive)) {
          const dates = subset.map((index) => openDays[index].date)
          const candidate = exchanged(current, dates, closer.employeeId, partner.id)
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
              swap: { date: day.date, from: closer.employeeId, to: partner.id },
              spread: candidateSpread,
            }
          }
          break
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
