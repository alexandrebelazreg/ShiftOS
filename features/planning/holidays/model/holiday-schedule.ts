import type { IsoDate } from "@/features/core/models"
import { frenchHolidaysOf, type FrenchHolidayKey } from "@/features/planning/holidays/model/french-holidays"

/**
 * Ce que le magasin fait de chaque jour férié.
 *
 * DEUX informations, et pas une seule, parce qu'elles ne répondent pas à la
 * même question :
 *
 * - le STATUT (chômé / demi-chômé / travaillé) décide du traitement de paie de
 *   chaque salarié — c'est lui qui entre dans la table de décision RH ;
 * - les HORAIRES EXCEPTIONNELS disent à quelle heure le rideau se lève ce
 *   jour-là, qui n'est presque jamais l'horaire habituel du jour de la semaine.
 *
 * Les déduire l'un de l'autre était tentant et faux dans les deux sens : une
 * ouverture 08:30–12:30 ne prouve pas un demi-chômage (un magasin peut ouvrir
 * court un jour travaillé), et un statut ne dit pas une heure.
 */

export type HolidayOpening = "chome" | "demi-chome" | "travaille"

export const HOLIDAY_OPENING_LABELS: Record<HolidayOpening, string> = {
  "chome": "Jour chômé",
  "demi-chome": "½ jour chômé",
  "travaille": "Jour travaillé",
}

export interface HolidaySchedule {
  readonly key: FrenchHolidayKey
  readonly date: IsoDate
  readonly name: string
  readonly opening: HolidayOpening
  /** Les horaires du magasin CE jour-là. `null` quand il est chômé. */
  readonly opensAt: string | null
  readonly closesAt: string | null
}

/**
 * Les fériés chômés par défaut.
 *
 * Le 1er mai est le seul férié légalement chômé en France ; le Jour de l'An et
 * Noël le sont par un usage si constant dans la distribution alimentaire qu'en
 * proposer l'inverse serait un piège. Tous les autres sont proposés travaillés,
 * et le gérant tranche — c'est sa décision, pas celle du logiciel.
 */
const CLOSED_BY_DEFAULT: readonly FrenchHolidayKey[] = ["jour-de-l-an", "fete-du-travail", "noel"]

/** L'heure minimale de fermeture attendue un dimanche férié travaillé. */
export const SUNDAY_HOLIDAY_MINIMUM_CLOSING = "15:00"

/**
 * Le calendrier d'une année, prêt à être réglé.
 *
 * Les horaires proposés sont ceux du magasin pour ce jour de la semaine : un
 * point de départ, pas une vérité. Un férié ouvre rarement comme un jour
 * ordinaire, et c'est précisément pour cela qu'on les saisit.
 */
export function defaultHolidaySchedules(
  year: number,
  usualHours: (date: IsoDate) => { readonly opensAt: string; readonly closesAt: string } | null
): readonly HolidaySchedule[] {
  return frenchHolidaysOf(year).map((holiday) => {
    // Un dimanche férié est TOUJOURS proposé travaillé, même dans un magasin
    // qui n'ouvre jamais le dimanche. Ce n'est pas une prédiction d'ouverture :
    // c'est que le traitement d'un dimanche férié se joue salarié par salarié
    // (RH ou heures fériées), et que le déclarer chômé masquerait cet arbitrage.
    const sunday = isSunday(holiday.date)
    const opening: HolidayOpening =
      sunday ? "travaille" : CLOSED_BY_DEFAULT.includes(holiday.key) ? "chome" : "travaille"
    const hours = opening === "chome" ? null : usualHours(holiday.date)
    return {
      key: holiday.key,
      date: holiday.date,
      name: holiday.name,
      opening,
      opensAt: hours?.opensAt ?? null,
      closesAt: hours?.closesAt ?? null,
    }
  })
}

export interface HolidayScheduleWarning {
  readonly date: IsoDate
  readonly message: string
}

/**
 * Ce qui cloche dans le réglage, sans jamais l'empêcher.
 *
 * Des avertissements et non des refus : un magasin peut avoir une raison de
 * fermer tôt un dimanche férié, et un logiciel qui bloquerait là-dessus se
 * ferait contourner. Il dit ce qu'il voit, le gérant tranche.
 */
export function holidayScheduleWarnings(
  schedules: readonly HolidaySchedule[]
): readonly HolidayScheduleWarning[] {
  const warnings: HolidayScheduleWarning[] = []
  for (const schedule of schedules) {
    if (schedule.opening !== "chome" && (!schedule.opensAt || !schedule.closesAt)) {
      warnings.push({
        date: schedule.date,
        message: `${schedule.name} est ouvert mais n’a pas d’horaires : le planning n’aura pas de journée à remplir.`,
      })
      continue
    }
    if (
      isSunday(schedule.date)
      && schedule.opening === "travaille"
      && schedule.closesAt !== null
      && schedule.closesAt < SUNDAY_HOLIDAY_MINIMUM_CLOSING
    ) {
      warnings.push({
        date: schedule.date,
        message: `${schedule.name} tombe un dimanche : la fermeture est attendue à ${SUNDAY_HOLIDAY_MINIMUM_CLOSING} au plus tôt.`,
      })
    }
  }
  return warnings
}

export function isSunday(date: IsoDate): boolean {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0
}
