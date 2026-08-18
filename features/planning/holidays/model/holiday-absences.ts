import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { IsoDate } from "@/features/core/models"
import type { StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import type { HolidaySchedule } from "@/features/planning/holidays/model/holiday-schedule"

/**
 * Les jours fériés, vus depuis l'écran des absences.
 *
 * Un férié TRAVAILLÉ ne fait pas venir tout le monde : l'écran des jours fériés
 * recueille des volontaires, et ceux qui ne s'y sont pas portés ne viennent pas.
 * Sans cette lecture, le calendrier des absences annoncerait une équipe au
 * complet le 14 juillet, ce qui est exactement le contraire de ce qui se passe.
 *
 * Un férié CHÔMÉ ne produit rien ici : ce n'est pas une absence, c'est un
 * magasin fermé — personne n'est attendu, donc personne ne manque. Il se traite
 * comme un jour de fermeture, en grisant la colonne (`closedHolidayDates`).
 *
 * Ces absences ne se corrigent pas dans l'écran des absences : elles portent
 * leur source, et on se rend dans l'écran des jours fériés pour y changer
 * quelque chose. C'est là qu'on coche un volontaire.
 */

export interface HolidayAbsenceInput {
  readonly schedules: readonly HolidaySchedule[]
  readonly stored: StoredHolidays
  /** L'équipe active : elle seule peut manquer. */
  readonly employeeIds: readonly string[]
}

/** Les journées où le rideau reste baissé — ni travail ni absence. */
export function closedHolidayDates(input: Omit<HolidayAbsenceInput, "employeeIds">): ReadonlySet<IsoDate> {
  return new Set(
    input.schedules
      .filter((schedule) => openingOf(input.stored, schedule) === "chome")
      .map((schedule) => schedule.date)
  )
}

/** Qui manque à l'appel sur chaque férié ouvert. */
export function holidayAbsences(input: HolidayAbsenceInput): readonly AbsenceRecord[] {
  return input.schedules.flatMap((schedule) => {
    if (openingOf(input.stored, schedule) === "chome") return []
    const volunteers = new Set(input.stored[schedule.date]?.volunteerIds ?? [])
    return input.employeeIds
      .filter((employeeId) => !volunteers.has(employeeId))
      .map((employeeId) => ({
        // Déterministe, et reconstruit à chaque lecture : rien n'est enregistré,
        // donc cocher un volontaire fait disparaître son absence du même geste.
        id: `holiday:${schedule.date}:${employeeId}`,
        employeeId,
        type: "public_holiday",
        start: schedule.date,
        end: schedule.date,
        source: "holiday" as const,
        note: `${schedule.name} — non volontaire`,
      }))
  })
}

/** Le réglage du gérant l'emporte sur la proposition par défaut. */
function openingOf(stored: StoredHolidays, schedule: HolidaySchedule): string {
  return stored[schedule.date]?.opening ?? schedule.opening
}
