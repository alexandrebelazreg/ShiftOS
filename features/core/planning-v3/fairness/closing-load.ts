import type { EmployeeId } from "@/features/core/models"
import type { PlanningClosingHistoryV3 } from "@/features/core/planning-v3/types/problem"

/**
 * Closing load, compared without a single floating-point number.
 *
 * A load is a FRACTION — closings over opportunities — and fractions are what
 * makes fairness mean anything: two closings out of two is heavier than three
 * out of eight. But evaluating them as decimals makes the comparison depend on
 * rounding, and a solver that tie-breaks on a rounded value is a solver whose
 * answer can change between machines. So loads are never divided: they are
 * compared by CROSS PRODUCT, `a.closings * b.opportunities` against
 * `b.closings * a.opportunities`, which is exact in integers and gives the same
 * verdict everywhere.
 *
 * Zero opportunities is not zero load, it is NO load: someone who never could
 * have closed is neither ahead nor behind. They sort last so they are picked
 * first when a closing must be handed out — which is the correct reading, since
 * a week where they finally can close is the week to give them one.
 */

/**
 * La part d'une semaine, exprimée en cinquièmes.
 *
 * L'unité d'équité est LA SEMAINE, pas le jour. Un salarié à cinq jours et un
 * salarié à six jours prennent la même part de fermetures : compter les jours
 * les déclarait à égalité pour des nombres de fermetures très différents — six
 * fermetures sur dix-huit jours et deux sur six donnent le même rapport, alors
 * que l'un a fermé trois fois plus souvent. C'est ce que le gérant lisait, et
 * qu'il refusait à juste titre.
 *
 * Sous cinq jours, la part redevient proportionnelle : quelqu'un qui vient deux
 * jours par semaine ne peut pas porter autant de fermetures que quelqu'un qui
 * vient six fois, et lui en demander autant reviendrait à le faire fermer
 * presque à chaque venue.
 *
 * Exprimée en CINQUIÈMES et non en fraction décimale : le dénominateur des
 * charges doit rester entier, parce que les moteurs comparent les charges par
 * produit en croix — exact en entiers, dépendant de l'arrondi sinon, donc
 * susceptible de changer d'une machine à l'autre.
 *
 * Le plancher à 1 protège un cas de données : quelqu'un qui a réellement fermé
 * doit avoir une part non nulle, sinon sa fermeture existerait sans rien pour
 * la rapporter et sa charge deviendrait incalculable.
 */
export const FULL_SHARE_WORKING_DAYS = 5

export function weeklyClosingShare(contractedWorkingDays: number): number {
  return Math.max(1, Math.min(FULL_SHARE_WORKING_DAYS, contractedWorkingDays))
}

export interface ClosingLoad {
  readonly employeeId: EmployeeId
  readonly closings: number
  readonly opportunities: number
}

/**
 * Compare two loads. Negative when `left` is LIGHTER — that is, when `left`
 * deserves the next closing.
 *
 * Total and deterministic: ties fall back to the employee id, so two identical
 * loads always order the same way and both engines can rely on it.
 */
export function compareClosingLoad(left: ClosingLoad, right: ClosingLoad): number {
  const leftUnknown = left.opportunities <= 0
  const rightUnknown = right.opportunities <= 0
  if (leftUnknown || rightUnknown) {
    // Never having had the chance is not the same as having refused it.
    if (leftUnknown && rightUnknown) return String(left.employeeId).localeCompare(String(right.employeeId))
    return leftUnknown ? -1 : 1
  }

  // left.closings / left.opportunities  vs  right.closings / right.opportunities
  const leftWeight = left.closings * right.opportunities
  const rightWeight = right.closings * left.opportunities
  if (leftWeight !== rightWeight) return leftWeight - rightWeight
  // Fewer opportunities at equal load means a thinner sample; the tie is broken
  // by the id so the order never depends on iteration.
  return String(left.employeeId).localeCompare(String(right.employeeId))
}

/**
 * The spread of a set of loads, as an integer permille (0–1000).
 *
 * Permille rather than a ratio for the same reason as above: it is reported to
 * humans and compared in tests, and an integer says the same thing on every
 * machine. Employees with no opportunity are excluded — they have no load to be
 * far from anyone else's.
 */
export function closingLoadSpreadPermille(loads: readonly ClosingLoad[]): number {
  const measurable = loads.filter((load) => load.opportunities > 0)
  if (measurable.length === 0) return 0
  const permilles = measurable.map((load) => Math.round((load.closings * 1000) / load.opportunities))
  return Math.max(...permilles) - Math.min(...permilles)
}

/** Merge the recorded history with what this week adds, per employee. */
export function loadsAfterWeek(
  history: readonly PlanningClosingHistoryV3[],
  addedClosings: Readonly<Record<string, number>>,
  addedOpportunities: Readonly<Record<string, number>>,
  employeeIds: readonly EmployeeId[]
): ClosingLoad[] {
  const byEmployee = new Map(history.map((entry) => [String(entry.employeeId), entry]))
  return employeeIds
    .map((employeeId) => {
      const past = byEmployee.get(String(employeeId))
      return {
        employeeId,
        closings: (past?.closings ?? 0) + (addedClosings[String(employeeId)] ?? 0),
        opportunities: (past?.opportunities ?? 0) + (addedOpportunities[String(employeeId)] ?? 0),
      }
    })
    .sort((left, right) => String(left.employeeId).localeCompare(String(right.employeeId)))
}

/** Same, for the Saturday tallies. A Saturday closing is in both. */
export function saturdayLoadsAfterWeek(
  history: readonly PlanningClosingHistoryV3[],
  addedClosings: Readonly<Record<string, number>>,
  addedOpportunities: Readonly<Record<string, number>>,
  employeeIds: readonly EmployeeId[]
): ClosingLoad[] {
  const byEmployee = new Map(history.map((entry) => [String(entry.employeeId), entry]))
  return employeeIds
    .map((employeeId) => {
      const past = byEmployee.get(String(employeeId))
      return {
        employeeId,
        closings: (past?.saturdayClosings ?? 0) + (addedClosings[String(employeeId)] ?? 0),
        opportunities: (past?.saturdayOpportunities ?? 0) + (addedOpportunities[String(employeeId)] ?? 0),
      }
    })
    .sort((left, right) => String(left.employeeId).localeCompare(String(right.employeeId)))
}
