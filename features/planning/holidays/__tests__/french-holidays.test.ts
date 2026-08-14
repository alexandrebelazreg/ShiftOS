import { describe, expect, it } from "vitest"

import {
  easterSunday,
  frenchHolidaysOf,
  FRENCH_HOLIDAY_KEYS,
} from "@/features/planning/holidays/model/french-holidays"
import {
  defaultHolidaySchedules,
  holidayScheduleWarnings,
  isSunday,
} from "@/features/planning/holidays/model/holiday-schedule"

/**
 * L'almanach, vérifié contre la fiche magasin de l'enseigne.
 *
 * Les dates de 2024 viennent de la capture du paramétrage réel, jours de la
 * semaine compris. C'est le seul témoin qui vaille : un comput de Pâques juste
 * « en théorie » et faux d'un jour déplacerait trois fériés par an.
 */

describe("les onze fériés français", () => {
  it("rend les dates de 2024 telles que la fiche magasin les affiche", () => {
    expect(frenchHolidaysOf(2024).map((holiday) => [holiday.name, holiday.date])).toEqual([
      ["Jour de l’An", "2024-01-01"],
      ["Lundi de Pâques", "2024-04-01"],
      ["Fête du Travail", "2024-05-01"],
      ["Victoire 1945", "2024-05-08"],
      ["Ascension", "2024-05-09"],
      ["Lundi de Pentecôte", "2024-05-20"],
      ["Fête Nationale", "2024-07-14"],
      ["Assomption", "2024-08-15"],
      ["Toussaint", "2024-11-01"],
      ["Armistice 1918", "2024-11-11"],
      ["Noël", "2024-12-25"],
    ])
  })

  it("en rend onze, toujours, et dans l’ordre du calendrier", () => {
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      const holidays = frenchHolidaysOf(year)
      expect(holidays).toHaveLength(FRENCH_HOLIDAY_KEYS.length)
      const dates = holidays.map((holiday) => holiday.date)
      expect([...dates].sort()).toEqual(dates)
    }
  })

  it("calcule Pâques sur des années connues", () => {
    // Trois fériés en dépendent ; un décalage d'un jour les décale tous.
    expect(easterSunday(2024)).toBe("2024-03-31")
    expect(easterSunday(2025)).toBe("2025-04-20")
    expect(easterSunday(2026)).toBe("2026-04-05")
    expect(easterSunday(2027)).toBe("2027-03-28")
    expect(easterSunday(2038)).toBe("2038-04-25") // la date la plus tardive possible
    expect(easterSunday(2285)).toBe("2285-03-22") // la plus précoce possible
  })

  it("place les trois fériés mobiles à leur écart de Pâques", () => {
    const holidays = frenchHolidaysOf(2026)
    const byName = new Map(holidays.map((holiday) => [holiday.key, holiday.date]))

    expect(byName.get("lundi-de-paques")).toBe("2026-04-06")
    expect(byName.get("ascension")).toBe("2026-05-14")
    expect(byName.get("lundi-de-pentecote")).toBe("2026-05-25")
  })
})

describe("le réglage par défaut du magasin", () => {
  const usual = () => ({ opensAt: "08:30", closesAt: "20:00" })

  it("ne chôme d’office que le 1er janvier, le 1er mai et Noël", () => {
    const schedules = defaultHolidaySchedules(2026, usual)
    const closed = schedules.filter((entry) => entry.opening === "chome").map((entry) => entry.key)

    expect(closed).toEqual(["jour-de-l-an", "fete-du-travail", "noel"])
  })

  it("propose tout dimanche férié en jour travaillé, même chômé d’ordinaire", () => {
    // Le 1er novembre 2026 tombe un dimanche ; le 1er janvier 2023 aussi.
    const toussaint = defaultHolidaySchedules(2026, usual).find((e) => e.key === "toussaint")
    expect(isSunday("2026-11-01")).toBe(true)
    expect(toussaint?.opening).toBe("travaille")

    const newYear = defaultHolidaySchedules(2023, usual).find((e) => e.key === "jour-de-l-an")
    expect(isSunday("2023-01-01")).toBe(true)
    // Chômé par défaut en semaine, mais un dimanche l'arbitrage revient au
    // traitement par salarié : on ne le masque pas derrière un magasin fermé.
    expect(newYear?.opening).toBe("travaille")
  })

  it("ne donne aucun horaire à un jour chômé", () => {
    const noel = defaultHolidaySchedules(2026, usual).find((entry) => entry.key === "noel")

    expect(noel).toMatchObject({ opening: "chome", opensAt: null, closesAt: null })
  })
})

describe("les avertissements du réglage", () => {
  const base = {
    key: "toussaint" as const,
    date: "2026-11-01",
    name: "Toussaint",
    opening: "travaille" as const,
  }

  it("signale un dimanche férié qui ferme avant 15h, sans l’interdire", () => {
    const warnings = holidayScheduleWarnings([{ ...base, opensAt: "08:30", closesAt: "12:30" }])

    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toContain("15:00")
  })

  it("se tait quand le dimanche ferme assez tard", () => {
    expect(holidayScheduleWarnings([{ ...base, opensAt: "08:30", closesAt: "15:00" }])).toEqual([])
  })

  it("signale une journée ouverte sans horaires", () => {
    const warnings = holidayScheduleWarnings([{ ...base, opensAt: null, closesAt: null }])

    expect(warnings[0].message).toContain("pas d’horaires")
  })

  it("ne reproche rien à un jour chômé", () => {
    expect(
      holidayScheduleWarnings([
        { ...base, opening: "chome", opensAt: null, closesAt: null },
      ])
    ).toEqual([])
  })
})
