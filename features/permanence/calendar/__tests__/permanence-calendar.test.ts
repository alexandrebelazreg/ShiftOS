import { describe, expect, it } from "vitest"

import type { IsoDate, WeekDay } from "@/features/core/models"
import {
  buildPermanenceCalendar,
  type PermanenceHoliday,
} from "@/features/permanence/calendar/permanence-calendar"

/** Un magasin ordinaire : ouvert du lundi au samedi, fermé le dimanche. */
const weekdaysOnly = (day: WeekDay) => day !== "sunday"
const everyDay = () => true
const noHoliday = () => null

const calendar = (patch: Partial<Parameters<typeof buildPermanenceCalendar>[0]> = {}) =>
  buildPermanenceCalendar({
    year: 2026,
    month: 1,
    opensOn: weekdaysOnly,
    holidayOf: noHoliday,
    ...patch,
  })

describe("le calendrier d’un mois de permanence", () => {
  it("découpe janvier 2026 en cinq semaines, numérotées comme la feuille", () => {
    expect(calendar().weeks.map((week) => week.number)).toEqual([1, 2, 3, 4, 5])
    expect(calendar().label).toBe("Janvier 2026")
  })

  it("montre les journées de la semaine à cheval, sans les rendre remplissables", () => {
    // S1 court du 29 décembre au 3 janvier : les trois premières appartiennent
    // à décembre et s'affichent « — », exactement comme dans le classeur.
    const first = calendar().weeks[0]

    expect(first.days.map((day) => day.inMonth)).toEqual([false, false, false, true, true, true])
    expect(first.days[0]).toMatchObject({ closedLabel: "—", open: false })
    expect(first.days[3]).toMatchObject({ date: "2026-01-01", label: "1/01", open: true })
  })

  it("laisse le dimanche hors de la grille quand le magasin n’ouvre pas ce jour-là", () => {
    expect(calendar().weekDays).not.toContain("sunday")
    expect(calendar({ opensOn: everyDay }).weekDays).toContain("sunday")
  })

  it("donne une colonne au dimanche dès que le magasin l’ouvre", () => {
    const sundays = calendar({ opensOn: everyDay })
      .openDays.filter((day) => day.weekDay === "sunday")
      .map((day) => day.date)

    expect(sundays).toEqual([
      "2026-01-04",
      "2026-01-11",
      "2026-01-18",
      "2026-01-25",
    ])
  })

  it("ferme la journée d’un férié chômé, et la nomme quand même", () => {
    const newYear = calendar({
      holidayOf: (date: IsoDate): PermanenceHoliday | null =>
        date === "2026-01-01" ? { name: "Jour de l’An", closed: true } : null,
    })
      .weeks[0].days.find((day) => day.date === "2026-01-01")

    expect(newYear).toMatchObject({ open: false, closedLabel: "FERMÉ", holidayName: "Jour de l’An" })
  })

  it("garde ouverte la journée d’un férié travaillé, en l’annonçant", () => {
    const newYear = calendar({
      holidayOf: (date: IsoDate): PermanenceHoliday | null =>
        date === "2026-01-01" ? { name: "Jour de l’An", closed: false } : null,
    })
      .weeks[0].days.find((day) => day.date === "2026-01-01")

    expect(newYear).toMatchObject({ open: true, closedLabel: null, holidayName: "Jour de l’An" })
  })

  it("n’ouvre jamais une journée que le magasin ferme, même pour un férié travaillé", () => {
    // Le calendrier des fériés propose « travaillé » pour tout dimanche férié,
    // y compris là où le magasin n'ouvre jamais le dimanche. Le lire comme une
    // ouverture inventerait une permanence rideau baissé.
    const sunday = buildPermanenceCalendar({
      year: 2026,
      month: 11,
      opensOn: weekdaysOnly,
      holidayOf: (date) => (date === "2026-11-01" ? { name: "Toussaint", closed: false } : null),
    })

    expect(sunday.openDays.some((day) => day.date === "2026-11-01")).toBe(false)
  })

  it("barre les journées de la semaine où le magasin est fermé", () => {
    const closedOnMonday = calendar({ opensOn: (day: WeekDay) => day !== "monday" })
    const monday = closedOnMonday.weeks[1].days.find((day) => day.weekDay === "monday")

    expect(monday).toMatchObject({ inMonth: true, open: false, closedLabel: "Fermé" })
    expect(closedOnMonday.weekDays).toContain("monday")
  })

  it("ne retient comme journées à pourvoir que celles du mois", () => {
    const dates = calendar().openDays.map((day) => day.date)

    expect(dates[0]).toBe("2026-01-01")
    expect(dates[dates.length - 1]).toBe("2026-01-31")
    // 31 jours, moins les 4 dimanches d'un magasin qui n'ouvre pas ce jour-là.
    expect(dates).toHaveLength(27)
  })

  it("étale mars 2026 sur six semaines, comme la feuille", () => {
    const march = calendar({ month: 3 })

    expect(march.weeks.map((week) => week.number)).toEqual([9, 10, 11, 12, 13, 14])
    // S9 ne contient que le dimanche 1er mars, hors grille : la bande existe et
    // reste vide, plutôt que de faire commencer le mois à S10.
    expect(march.weeks[0].days.every((day) => !day.inMonth)).toBe(true)
  })
})
