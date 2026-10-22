import type {
  PlanningDayV3,
  PlanningEmployeeDayV3,
  PlanningEmployeeV3,
  PlanningRulesV3,
} from "@/features/core/planning-v3/types/problem"

/**
 * Ce qu'un férié laisse réellement à placer, rayon par rayon.
 *
 * Un férié travaillé n'ouvre ses portes qu'aux volontaires, mais la journée
 * gardait la part de la semaine qu'elle a d'ordinaire : sur le Drive, une
 * trentaine d'heures pour deux volontaires, et zéro volontaire laissait une
 * journée ouverte que personne n'avait le droit de tenir. Le moteur place le
 * budget du jour à la minute près — la semaine entière était refusée.
 *
 * Donc, pour chaque férié de la période :
 * - la journée reçoit au plus une JOURNÉE ORDINAIRE de chacun de ses
 *   volontaires disponibles — son contrat sur ses jours disponibles. Pas tout
 *   ce qu'il pourrait tenir : le moteur fait travailler chaque jour disponible,
 *   et un volontaire chargé d'une grosse journée fériée n'aurait plus de quoi
 *   remplir les autres ;
 * - sans aucun volontaire disponible, le rayon est FERMÉ ce jour-là ;
 * - un férié chômé ne reçoit rien, comme avant ;
 * - quand il reste moins de volontaires que de rôles distincts, l'ouverture
 *   passe d'abord : un volontaire seul ouvre, et personne n'est exigé à la
 *   fermeture — la règle « un ouvreur, un fermeur » supposait deux personnes ;
 * - ce que la journée ne peut pas porter passe aux autres jours ouverts, au
 *   prorata de leur part. Le total de la semaine ne change pas : il est déjà
 *   celui des contrats, fériés déduits.
 *
 * Sans férié, rien ne se passe et le problème est celui d'avant.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/**
 * Le plus de minutes qu'UNE personne peut travailler UN jour — la copie exacte
 * de `_daily_ceiling` (`shiftos_highs/demand.py`), qui décide côté moteur.
 *
 * Une copie, et elle doit le rester : la journée fériée se dimensionnait sur le
 * seul plafond du jour, en ignorant la durée maximale d'un créneau et la traite
 * continue. Le moteur, lui, les compte — il annonçait alors « le budget impose
 * 9 h, les 2 salariés disponibles peuvent fournir au maximum 8 h 15 » et
 * refusait la semaine. Modifier l'une sans l'autre recrée exactement ce refus.
 */
export function dailyCeilingMinutes(
  employee: Pick<PlanningEmployeeV3, "maximumDailyMinutes" | "canSplitShift">,
  entry: Pick<PlanningEmployeeDayV3, "maximumMinutes" | "earliestStartMinutes" | "latestEndMinutes">,
  rules: Pick<
    PlanningRulesV3,
    "maximumShiftMinutes" | "maximumContinuousMinutes" | "splitShiftAllowed" | "maximumSplitsPerDay" | "minimumSplitMinutes"
  >
): number {
  const window = entry.latestEndMinutes - entry.earliestStartMinutes
  const base = Math.min(employee.maximumDailyMinutes, entry.maximumMinutes, rules.maximumShiftMinutes, window)
  const continuous = rules.maximumContinuousMinutes
  if (continuous === null || continuous === undefined) return Math.max(0, base)
  const maySplit = rules.splitShiftAllowed && employee.canSplitShift && (rules.maximumSplitsPerDay ?? 1) >= 1
  if (!maySplit) return Math.max(0, Math.min(base, continuous))
  // Le droit de couper n'oblige pas à couper : la journée d'un seul tenant
  // reste permise, et c'est elle qui va le plus loin sur une amplitude courte.
  return Math.max(
    0,
    Math.min(base, continuous),
    Math.min(base, 2 * continuous, window - (rules.minimumSplitMinutes ?? 0))
  )
}

export interface HolidayStaffing {
  readonly days: PlanningDayV3[]
  /** Les journées fermées faute de volontaire — leur demande ne se pose pas. */
  readonly closedDates: ReadonlySet<string>
  /** Les personnes disponibles chaque férié, pour plafonner les planchers durs. */
  readonly availableByDate: ReadonlyMap<string, number>
}

export function settleHolidayDays(
  days: readonly PlanningDayV3[],
  employeeDays: readonly PlanningEmployeeDayV3[],
  /** Par date fériée : la part ordinaire du jour, avant que le férié ne la touche. */
  holidayShare: ReadonlyMap<string, { readonly share: number; readonly chome: boolean }>,
  employees: readonly PlanningEmployeeV3[],
  rules: PlanningRulesV3,
  step: number
): HolidayStaffing {
  const employeeById = new Map(employees.map((employee) => [String(employee.id), employee]))
  const roles = { openings: rules.minimumOpeningsPerDay, closings: rules.exactClosingsPerDay }
  const closedDates = new Set<string>()
  const availableByDate = new Map<string, number>()
  if (holidayShare.size === 0) return { days: [...days], closedDates, availableByDate }

  const next: Mutable<PlanningDayV3>[] = days.map((day) => ({ ...day }))
  let excess = 0

  for (const day of next) {
    const holiday = holidayShare.get(day.date)
    if (holiday === undefined) continue
    const present = employeeDays.filter((entry) => entry.date === day.date && entry.available)
    availableByDate.set(day.date, present.length)
    if (holiday.chome) {
      // Déjà fermée et à zéro ; seule sa part, perdue jusqu'ici, change de jour.
      // « chômé » vaut aussi, en zone, pour une journée que tous les rayons ont
      // fermée faute de volontaire : sa part doit, de même, changer de jour.
      excess += holiday.share
      day.budgetMinutes = 0
      continue
    }
    if (day.closed) continue

    // Les bornes que le moteur applique à chaque personne présente, au pas :
    // son plafond réel et, si sa journée est obligatoire, son minimum.
    let capacity = 0
    let floor = 0
    let ordinary = 0
    for (const entry of present) {
      const id = String(entry.employeeId)
      const employee = employeeById.get(id)
      if (employee === undefined) continue
      const ceiling = Math.floor(dailyCeilingMinutes(employee, entry, rules) / step) * step
      capacity += ceiling
      if (entry.mandatory) {
        const minimum = Math.ceil(Math.max(employee.minimumDailyMinutes, rules.minimumShiftMinutes) / step) * step
        floor += Math.min(minimum, ceiling)
      }
      const worked = employeeDays.filter((other) => String(other.employeeId) === id && other.available).length
      ordinary += Math.min(ceiling, employee.contractMinutes / Math.max(1, worked))
    }
    const wanted = Math.round(Math.min(holiday.share, ordinary) / step) * step
    const allowed = Math.min(capacity, Math.max(floor, wanted))
    excess += day.budgetMinutes - allowed
    day.budgetMinutes = allowed
    if (present.length > 0 && present.length < roles.openings + roles.closings) {
      const openings = Math.min(roles.openings, present.length)
      day.minimumOpenings = openings
      day.exactClosings = Math.max(0, Math.min(roles.closings, present.length - openings))
    }
    if (present.length === 0) {
      day.closed = true
      day.opensAtMinutes = null
      day.closesAtMinutes = null
      day.budgetMinutes = 0
      closedDates.add(day.date)
    }
  }

  // Les receveurs : les jours ouverts qui ne sont pas fériés, au prorata de ce
  // qu'ils portent déjà. Le reliquat d'arrondi va au plus chargé.
  const receivers = next.filter(
    (day) => !day.closed && !holidayShare.has(day.date) && day.budgetMinutes > 0
  )
  if (excess > 0 && receivers.length > 0) {
    // Plus forts restes, au pas : le total à répartir est celui des receveurs
    // plus l'excédent, et chacun en reçoit la part que lui donnait déjà la
    // semaine. Des jours égaux restent égaux — une division arrondie jour par
    // jour en faisait 765 et 705, et un écart que personne n'a demandé suffit
    // à rendre une semaine serrée impossible.
    const weight = receivers.reduce((sum, day) => sum + day.budgetMinutes, 0)
    const units = (weight + excess) / step
    const exact = receivers.map((day) => (units * day.budgetMinutes) / weight)
    const floors = exact.map(Math.floor)
    let left = units - floors.reduce((sum, value) => sum + value, 0)
    const order = exact
      .map((value, index) => ({ index, rest: value - floors[index] }))
      .sort((a, b) => b.rest - a.rest || a.index - b.index)
    for (const { index } of order) {
      if (left <= 0) break
      floors[index] += 1
      left -= 1
    }
    receivers.forEach((day, index) => {
      day.budgetMinutes = floors[index] * step
    })
  }

  return { days: next, closedDates, availableByDate }
}
