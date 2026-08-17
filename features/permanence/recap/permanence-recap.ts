import type { WeekDay } from "@/features/core/models"
import { isValidIsoDate, weekDayOf } from "@/features/core/shared"
import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import {
  addLoads,
  EMPTY_LOAD,
  totalPermanences,
  withPermanence,
  type PermanenceLoad,
} from "@/features/permanence/models/permanence-load"
import { PERMANENCE_ROLES, type PermanenceMonth } from "@/features/permanence/models/permanence-month"

/**
 * Le récapitulatif : combien de fermetures chacun a portées, dont combien de
 * samedis, et combien de dimanches.
 *
 * C'est la pièce qui rend le tour DISCUTABLE. Une répartition qu'on ne peut pas
 * compter ne peut pas être contestée, et une répartition qu'on ne peut pas
 * contester finit par ne plus être acceptée. Les trois chiffres demandés sont
 * en tête ; le détail par jour de la semaine suit, parce que quatre fermetures
 * dont quatre vendredis et quatre fermetures étalées ne sont pas la même
 * charge.
 *
 * Compté depuis les affectations, jamais tenu à part : un compteur entretenu en
 * parallèle des cases finit toujours par diverger de ce que la feuille montre.
 */

export interface PermanenceRecapRow {
  readonly employeeId: string
  readonly name: string
  readonly load: PermanenceLoad
  /** Ouvertures et fermetures réunies. */
  readonly total: number
}

export interface PermanenceRecap {
  readonly rows: readonly PermanenceRecapRow[]
  readonly totals: PermanenceLoad
  /**
   * L'écart entre celui qui ferme le plus et celui qui ferme le moins.
   *
   * Le seul chiffre qui juge la répartition elle-même : les totaux disent ce
   * qui a été fait, celui-ci dit si ce fut équitable.
   */
  readonly closingSpread: number
  /** Idem pour les samedis, la charge dont on discute le plus. */
  readonly saturdaySpread: number
}

/** La charge d'un mois, personne par personne. */
export function permanenceLoads(
  month: PermanenceMonth,
  roster: readonly PermanenceMember[]
): ReadonlyMap<string, PermanenceLoad> {
  const loads = new Map<string, PermanenceLoad>(
    roster.map((member) => [member.employeeId, EMPTY_LOAD])
  )

  for (const [key, employeeId] of Object.entries(month.assignments)) {
    if (!loads.has(employeeId)) continue
    const parsed = parseSlotKey(key)
    if (!parsed) continue
    loads.set(
      employeeId,
      withPermanence(loads.get(employeeId) ?? EMPTY_LOAD, parsed.weekDay, parsed.role)
    )
  }

  return loads
}

/** Le récapitulatif d'un mois — ou de plusieurs, additionnés. */
export function buildPermanenceRecap(
  months: readonly PermanenceMonth[],
  roster: readonly PermanenceMember[]
): PermanenceRecap {
  const summed = new Map<string, PermanenceLoad>(
    roster.map((member) => [member.employeeId, EMPTY_LOAD])
  )
  for (const month of months) {
    for (const [employeeId, load] of permanenceLoads(month, roster)) {
      summed.set(employeeId, addLoads(summed.get(employeeId) ?? EMPTY_LOAD, load))
    }
  }

  const rows = roster.map((member) => {
    const load = summed.get(member.employeeId) ?? EMPTY_LOAD
    return { employeeId: member.employeeId, name: member.name, load, total: totalPermanences(load) }
  })

  const totals = rows.reduce((sum, row) => addLoads(sum, row.load), EMPTY_LOAD)

  return {
    rows,
    totals,
    closingSpread: spread(rows.map((row) => row.load.closings)),
    saturdaySpread: spread(rows.map((row) => row.load.saturdayClosings)),
  }
}

/**
 * Ce que chacun a porté sur l'année, mois par mois — le tableau annuel de la
 * feuille, où chaque colonne est un mois et la dernière le total.
 */
export interface PermanenceYearRow {
  readonly employeeId: string
  readonly name: string
  /** Douze fermetures, de janvier à décembre. */
  readonly closingsByMonth: readonly number[]
  readonly closings: number
  readonly saturdayClosings: number
  readonly sundays: number
}

export function buildPermanenceYear(
  months: readonly PermanenceMonth[],
  roster: readonly PermanenceMember[]
): readonly PermanenceYearRow[] {
  // Les douze charges mensuelles et le cumul se calculent UNE fois, hors de la
  // boucle des personnes : les recalculer par personne relisait douze mois
  // autant de fois qu'il y a de monde dans le tour.
  const monthlyLoads = new Map<number, ReadonlyMap<string, PermanenceLoad>>(
    months.map((month) => [month.month, permanenceLoads(month, roster)])
  )
  const cumulative = new Map(
    buildPermanenceRecap(months, roster).rows.map((row) => [row.employeeId, row.load])
  )

  return roster.map((member) => {
    const closingsByMonth = Array.from(
      { length: 12 },
      (_, index) => monthlyLoads.get(index + 1)?.get(member.employeeId)?.closings ?? 0
    )
    const load = cumulative.get(member.employeeId) ?? EMPTY_LOAD

    return {
      employeeId: member.employeeId,
      name: member.name,
      closingsByMonth,
      closings: load.closings,
      saturdayClosings: load.saturdayClosings,
      sundays: load.sundays,
    }
  })
}

/** L'écart entre le plus chargé et le moins chargé. Zéro sur une équipe vide. */
function spread(values: readonly number[]): number {
  if (values.length === 0) return 0
  return Math.max(...values) - Math.min(...values)
}

/** "2026-01-05_closing" → la journée et le rôle. */
function parseSlotKey(key: string): { readonly weekDay: WeekDay; readonly role: "opening" | "closing" } | null {
  const separator = key.lastIndexOf("_")
  if (separator === -1) return null
  const date = key.slice(0, separator)
  const role = key.slice(separator + 1)
  if (!PERMANENCE_ROLES.includes(role as (typeof PERMANENCE_ROLES)[number])) return null
  // Un stockage abîmé ne doit pas faire tomber le récapitulatif : ce qu'il ne
  // sait pas lire, il ne le compte pas, plutôt que de compter une case fantôme
  // ou de dater une permanence du 32 janvier.
  if (!isValidIsoDate(date)) return null
  return { weekDay: weekDayOf(date), role: role as (typeof PERMANENCE_ROLES)[number] }
}
