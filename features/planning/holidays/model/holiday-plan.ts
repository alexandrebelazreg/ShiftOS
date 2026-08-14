import type { HolidayPlanEntry, IsoDate } from "@/features/core/models"
import type { StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { resolveSchedules } from "@/features/planning/holidays/model/holiday-year-view-model"
import {
  holidayTreatment,
  reducedMinutes,
  type ContractReduction,
  type DayCode,
} from "@/features/planning/holidays/model/holiday-treatment"
import { holidayProfileOf, type HolidayProfileInput } from "@/features/planning/holidays/model/employee-holiday-profile"

/**
 * Le pont entre l'écran des jours fériés et le moteur.
 *
 * Une STRUCTURE PLATE, en dates et en minutes, sans rien qui rappelle un
 * dépôt localStorage ni un composant React — pour la même raison que l'entrée
 * du board est pauvre : le moteur ne doit rien savoir de l'endroit où le gérant
 * a coché ses cases.
 *
 * Absent, il ne change RIEN. C'est la garantie centrale de ce fichier : un
 * magasin qui n'a pas ouvert l'écran des fériés produit exactement le planning
 * qu'il produisait avant, à l'octet près, parce que le moteur retombe sur son
 * ancien chemin. La nouveauté ne s'active que là où quelqu'un a décidé quelque
 * chose.
 */

// Le type et la règle d'éligibilité vivent dans le core, que le constructeur de
// problème lit. Réexportés ici pour que l'application n'ait qu'une porte
// d'entrée sur les fériés.
export type { HolidayPlanEntry } from "@/features/core/models"
export { holidayBlocksEmployee } from "@/features/core/models"

export type HolidayPlan = readonly HolidayPlanEntry[]

/**
 * Les fériés d'une période, prêts pour le moteur.
 *
 * Une période peut chevaucher deux années — la semaine du 28 décembre au
 * 3 janvier en porte deux fériés dans deux calendriers — donc les deux sont
 * résolues puis filtrées sur les dates réellement demandées.
 */
export function holidayPlanForPeriod(
  period: { readonly start: IsoDate; readonly end: IsoDate },
  stored: StoredHolidays,
  usualHours: (date: IsoDate) => { readonly opensAt: string; readonly closesAt: string } | null
): HolidayPlan {
  const years = new Set([yearOf(period.start), yearOf(period.end)])
  return [...years]
    .flatMap((year) => resolveSchedules(year, stored, usualHours))
    .filter((schedule) => schedule.date >= period.start && schedule.date <= period.end)
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((schedule) => ({
      date: schedule.date,
      opening: schedule.opening,
      volunteerIds: stored[schedule.date]?.volunteerIds ?? [],
      opensAtMinutes: minutesOfClock(schedule.opensAt),
      closesAtMinutes: minutesOfClock(schedule.closesAt),
    }))
}

function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4))
}

function minutesOfClock(value: string | null): number | null {
  if (!value) return null
  const [hours, minutes] = value.split(":").map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

export interface HolidayImpact {
  readonly date: IsoDate
  readonly codes: readonly DayCode[]
  readonly contractReduction: ContractReduction
  /** Les minutes retirées à ce que le moteur doit placer cette semaine. */
  readonly reducedMinutes: number
  readonly keepUsualShiftsAsHolidayHours: boolean
  readonly reason: string
}

export interface HolidayImpactInput {
  readonly entry: HolidayPlanEntry
  readonly employeeId: string
  readonly profile: HolidayProfileInput
  readonly contractMinutes: number
  readonly sunday: boolean
  readonly storeOpensSundays: boolean
  readonly usuallyWorksSundays: boolean
  readonly usualRestDay: boolean
}

/**
 * Ce qu'un jour férié coûte à la semaine d'un salarié, avant que le moteur ne
 * cherche quoi que ce soit.
 *
 * DEUX MINUTES DIFFÉRENTES SE RESSEMBLENT ICI, et les confondre serait le
 * défaut le plus coûteux de tout ce module :
 *
 * - pour un salarié en horaires VARIABLES, le cinquième retiré est une baisse
 *   RÉELLE de sa base contractuelle : ces heures ne sont ni dues ni payées ;
 * - pour un salarié en horaires FIXES, le même cinquième sort de ce que le
 *   moteur doit PLACER, mais les heures restent dues et payées — en heures
 *   fériées.
 *
 * Le moteur soustrait la même quantité dans les deux cas, sinon il tasserait un
 * contrat entier sur six jours au lieu de sept. La paie, elle, lit `codes` :
 * `JF` dit une base diminuée, `HF` dit des heures fériées.
 *
 * LIMITE ASSUMÉE : le cinquième sert de mesure de « une journée » même pour un
 * horaire fixe, alors que sa vraie journée habituelle pourrait être plus longue
 * ou plus courte. L'application ne modélise pas encore les semaines types, donc
 * ses plages habituelles ne sont écrites nulle part. Le jour où elles le seront,
 * c'est cette fonction qui doit lire les vraies minutes — et rien d'autre.
 */
export function holidayImpact(input: HolidayImpactInput): HolidayImpact {
  const profile = holidayProfileOf(input.profile)
  const treatment = holidayTreatment({
    opening: input.entry.opening,
    scheduleType: profile.scheduleType,
    forfaitJour: profile.forfaitJour,
    sunday: input.sunday,
    storeOpensSundays: input.storeOpensSundays,
    usuallyWorksSundays: input.usuallyWorksSundays,
    usualRestDay: input.usualRestDay,
    presence: input.entry.volunteerIds.includes(input.employeeId) ? "full" : "none",
  })

  // Un forfait jour ne compte pas d'heures : rien ne se retire de rien.
  if (profile.forfaitJour) {
    return {
      date: input.entry.date,
      codes: treatment.codes,
      contractReduction: "none",
      reducedMinutes: 0,
      keepUsualShiftsAsHolidayHours: false,
      reason: treatment.reason,
    }
  }

  // Les heures fériées d'un horaire fixe sortent du placement au même titre
  // qu'un cinquième retiré : le moteur a une journée de moins à remplir.
  const reduction: ContractReduction = treatment.keepUsualShiftsAsHolidayHours
    ? "one-fifth"
    : treatment.contractReduction

  return {
    date: input.entry.date,
    codes: treatment.codes,
    contractReduction: treatment.contractReduction,
    reducedMinutes: reducedMinutes(input.contractMinutes, reduction),
    keepUsualShiftsAsHolidayHours: treatment.keepUsualShiftsAsHolidayHours,
    reason: treatment.reason,
  }
}

/**
 * L'objectif de la semaine, fériés déduits.
 *
 * Jamais négatif : une semaine entièrement fériée laisse zéro à placer, pas une
 * dette que le moteur essaierait de combler ailleurs.
 */
export function weeklyTargetAfterHolidays(
  contractMinutes: number,
  impacts: readonly HolidayImpact[]
): number {
  const removed = impacts.reduce((sum, impact) => sum + impact.reducedMinutes, 0)
  return Math.max(0, contractMinutes - removed)
}
