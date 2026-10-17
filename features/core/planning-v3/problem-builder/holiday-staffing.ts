import type { PlanningDayV3, PlanningEmployeeDayV3 } from "@/features/core/planning-v3/types/problem"

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
 * - ce que la journée ne peut pas porter passe aux autres jours ouverts, au
 *   prorata de leur part. Le total de la semaine ne change pas : il est déjà
 *   celui des contrats, fériés déduits.
 *
 * Sans férié, rien ne se passe et le problème est celui d'avant.
 */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

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
  contractByEmployee: ReadonlyMap<string, number>,
  step: number
): HolidayStaffing {
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
      excess += holiday.share
      continue
    }
    if (day.closed) continue

    const capacity = present.reduce((sum, entry) => sum + entry.maximumMinutes, 0)
    const ordinary = present.reduce((sum, entry) => {
      const id = String(entry.employeeId)
      const worked = employeeDays.filter((other) => String(other.employeeId) === id && other.available).length
      return sum + Math.min(entry.maximumMinutes, (contractByEmployee.get(id) ?? 0) / Math.max(1, worked))
    }, 0)
    const allowed = Math.round(Math.min(holiday.share, ordinary, capacity) / step) * step
    excess += day.budgetMinutes - allowed
    day.budgetMinutes = allowed
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
