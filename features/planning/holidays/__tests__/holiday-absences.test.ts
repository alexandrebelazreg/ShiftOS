import { describe, expect, it } from "vitest"

import type { StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import {
  closedHolidayDates,
  holidayAbsences,
} from "@/features/planning/holidays/model/holiday-absences"
import { defaultHolidaySchedules } from "@/features/planning/holidays/model/holiday-schedule"

/**
 * Les fériés, vus depuis l'écran des absences.
 *
 * Ce qui est garanti : un férié travaillé fait manquer ceux qui ne se sont pas
 * portés volontaires, un férié chômé ne fait manquer personne, et rien de tout
 * cela ne se corrige dans l'écran des absences.
 */

const schedules = defaultHolidaySchedules(2026, () => ({
  opensAt: "08:30",
  closesAt: "20:00",
}))

const team = ["a", "b", "c"]

const build = (stored: StoredHolidays = {}) =>
  holidayAbsences({ schedules, stored, employeeIds: team })

/** Le 14 juillet 2026, proposé travaillé par défaut. */
const BASTILLE = "2026-07-14"
/** Le 1er mai, chômé par défaut. */
const MAY_DAY = "2026-05-01"

describe("les absences d’un jour férié", () => {
  it("fait manquer toute l’équipe sur un férié travaillé sans volontaire", () => {
    const missing = build().filter((absence) => absence.start === BASTILLE)

    expect(missing.map((absence) => absence.employeeId).sort()).toEqual(["a", "b", "c"])
    // Son propre motif, et non « Repos » : la ligne affichée doit s'annoncer
    // « Jour férié », qui est ce qu'elle est.
    expect(missing[0]).toMatchObject({ end: BASTILLE, source: "holiday", type: "public_holiday" })
  })

  it("retire de la liste ceux qui se sont portés volontaires", () => {
    const missing = build({ [BASTILLE]: { volunteerIds: ["a", "b"] } }).filter(
      (absence) => absence.start === BASTILLE
    )

    expect(missing.map((absence) => absence.employeeId)).toEqual(["c"])
  })

  it("ne fait manquer personne un férié chômé — le magasin est fermé", () => {
    // Personne n'y est attendu, donc personne n'y manque : compter une équipe
    // entière absente le 1er mai serait un contresens.
    expect(build().some((absence) => absence.start === MAY_DAY)).toBe(false)
  })

  it("suit le réglage du gérant plutôt que la proposition par défaut", () => {
    const worked = build({ [MAY_DAY]: { opening: "travaille" } })
    expect(worked.some((absence) => absence.start === MAY_DAY)).toBe(true)

    const closed = build({ [BASTILLE]: { opening: "chome" } })
    expect(closed.some((absence) => absence.start === BASTILLE)).toBe(false)
  })

  it("nomme le férié dans la note, pour qu’on sache d’où sort la ligne", () => {
    const [absence] = build().filter((entry) => entry.start === BASTILLE)

    expect(absence.note).toContain("Fête Nationale")
    expect(absence.note).toContain("non volontaire")
  })

  it("donne un identifiant stable, reconstruit à chaque lecture", () => {
    // Rien n'est enregistré : cocher un volontaire fait disparaître son absence
    // du même geste, sans qu'il reste une ligne à nettoyer.
    expect(build()[0].id).toBe(`holiday:${build()[0].start}:${build()[0].employeeId}`)
  })
})

describe("les journées fermées par un férié", () => {
  it("retient les fériés chômés, et eux seuls", () => {
    const closed = closedHolidayDates({ schedules, stored: {} })

    expect(closed.has(MAY_DAY)).toBe(true)
    expect(closed.has(BASTILLE)).toBe(false)
  })

  it("suit le réglage du gérant", () => {
    const closed = closedHolidayDates({ schedules, stored: { [BASTILLE]: { opening: "chome" } } })

    expect(closed.has(BASTILLE)).toBe(true)
  })
})
