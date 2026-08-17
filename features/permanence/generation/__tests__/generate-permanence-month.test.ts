import { describe, expect, it } from "vitest"

import type { IsoDate, WeekDay } from "@/features/core/models"
import { buildPermanenceCalendar } from "@/features/permanence/calendar/permanence-calendar"
import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import { generatePermanenceMonth } from "@/features/permanence/generation/generate-permanence-month"
import { EMPTY_LOAD } from "@/features/permanence/models/permanence-load"
import { permanenceSlotKey, type PermanenceRole } from "@/features/permanence/models/permanence-month"

const january = buildPermanenceCalendar({
  year: 2026,
  month: 1,
  opensOn: (day: WeekDay) => day !== "sunday",
  holidayOf: () => null,
})

function member(name: string, patch: Partial<PermanenceMember> = {}): PermanenceMember {
  return {
    employeeId: name.toLowerCase(),
    name,
    shortName: name,
    requiredOpeningDays: [],
    preferredOpeningDays: [],
    requiredClosingDays: [],
    preferredClosingDays: [],
    daysOff: [],
    ...patch,
  }
}

const team = [member("Adeline"), member("Bruno"), member("Camille"), member("Denis")]

const run = (patch: Partial<Parameters<typeof generatePermanenceMonth>[0]> = {}) =>
  generatePermanenceMonth({ calendar: january, roster: team, ...patch })

/** Combien de fois cette personne tient ce rôle. */
function count(
  assignments: Readonly<Record<string, string>>,
  employeeId: string,
  role: PermanenceRole,
  on?: (date: IsoDate) => boolean
): number {
  return Object.entries(assignments).filter(([key, id]) => {
    if (id !== employeeId || !key.endsWith(`_${role}`)) return false
    return on ? on(key.slice(0, key.lastIndexOf("_"))) : true
  }).length
}

const isSaturday = (date: IsoDate) =>
  new Date(`${date}T00:00:00.000Z`).getUTCDay() === 6

const spread = (values: readonly number[]) => Math.max(...values) - Math.min(...values)

describe("la génération d’un mois de permanences", () => {
  it("pourvoit chaque journée ouverte, une ouverture et une fermeture", () => {
    const { assignments, gaps } = run()

    expect(gaps).toEqual([])
    expect(Object.keys(assignments)).toHaveLength(january.openDays.length * 2)
    for (const day of january.openDays) {
      expect(assignments[permanenceSlotKey(day.date, "opening")]).toBeDefined()
      expect(assignments[permanenceSlotKey(day.date, "closing")]).toBeDefined()
    }
  })

  it("ne fait jamais ouvrir et fermer la même personne le même jour", () => {
    const { assignments } = run()

    for (const day of january.openDays) {
      expect(assignments[permanenceSlotKey(day.date, "opening")]).not.toBe(
        assignments[permanenceSlotKey(day.date, "closing")]
      )
    }
  })

  it("répartit les fermetures à une près", () => {
    const { assignments } = run()
    const closings = team.map((person) => count(assignments, person.employeeId, "closing"))

    expect(spread(closings)).toBeLessThanOrEqual(1)
  })

  it("répartit les fermetures du samedi à une près — c’est là que l’équité se juge", () => {
    const { assignments } = run()
    const saturdays = team.map((person) =>
      count(assignments, person.employeeId, "closing", isSaturday)
    )

    expect(saturdays.reduce((sum, value) => sum + value, 0)).toBe(5)
    expect(spread(saturdays)).toBeLessThanOrEqual(1)
  })

  it("honore un jour de fermeture imposé, tous les jours concernés du mois", () => {
    const imposed = [
      member("Adeline"),
      member("Bruno"),
      member("Camille", { requiredClosingDays: ["monday"] }),
      member("Denis"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster: imposed })
    const mondays = january.openDays.filter((day) => day.weekDay === "monday")

    expect(mondays).toHaveLength(4)
    for (const monday of mondays) {
      expect(assignments[permanenceSlotKey(monday.date, "closing")]).toBe("camille")
    }
  })

  it("départage par les préférences, une fois les charges égales", () => {
    // Adeline prend l'ouverture du lundi (premier de la liste, tout à zéro) et
    // se trouve occupée ; restent Bruno et Camille pour la fermeture, à charge
    // strictement égale — la préférence est alors le seul critère qui les sépare.
    const roster = [
      member("Adeline"),
      member("Bruno"),
      member("Camille", { preferredClosingDays: ["monday"] }),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })
    const firstMonday = january.openDays.find((day) => day.weekDay === "monday")

    expect(assignments[permanenceSlotKey(firstMonday!.date, "closing")]).toBe("camille")
  })

  it("ne planifie personne sur son repos fixe", () => {
    const roster = [
      member("Adeline", { daysOff: ["wednesday"] }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })
    const wednesdays = january.openDays.filter((day) => day.weekDay === "wednesday")

    for (const day of wednesdays) {
      expect(assignments[permanenceSlotKey(day.date, "opening")]).not.toBe("adeline")
      expect(assignments[permanenceSlotKey(day.date, "closing")]).not.toBe("adeline")
    }
  })

  it("ne confie pas les clés à quelqu’un d’absent", () => {
    const { assignments } = run({
      unavailableOn: (date) => (date <= "2026-01-15" ? new Set(["adeline"]) : new Set()),
    })
    const early = Object.entries(assignments).filter(([key]) => key < "2026-01-16")

    expect(early.some(([, id]) => id === "adeline")).toBe(false)
    // Et elle reprend le tour dès son retour, sans qu'il faille la réinscrire.
    expect(count(assignments, "adeline", "closing")).toBeGreaterThan(0)
  })

  it("reprend le passif de l’année : celui qui a déjà fait les samedis en fait moins", () => {
    const { assignments } = run({
      history: {
        adeline: { ...EMPTY_LOAD, closings: 10, saturdayClosings: 5 },
      },
    })

    expect(count(assignments, "adeline", "closing", isSaturday)).toBe(0)
    expect(count(assignments, "adeline", "closing")).toBeLessThan(
      count(assignments, "bruno", "closing")
    )
  })

  it("nomme les cases imposées à deux personnes plutôt que de trancher en silence", () => {
    const roster = [
      member("Adeline", { requiredClosingDays: ["monday"] }),
      member("Bruno", { requiredClosingDays: ["monday"] }),
      member("Camille"),
    ]
    const { conflicts } = generatePermanenceMonth({ calendar: january, roster })

    expect(conflicts).toHaveLength(4)
    expect(conflicts[0].message).toContain("Bruno")
    expect(conflicts[0].role).toBe("closing")
  })

  it("signale les cases que personne ne pouvait prendre", () => {
    const roster = [member("Adeline", { daysOff: ["monday"] })]
    const { gaps, assignments } = generatePermanenceMonth({ calendar: january, roster })

    // Une seule personne : elle ne peut pas ouvrir ET fermer, donc une case sur
    // deux reste vide, et toutes celles du lundi.
    expect(gaps.length).toBeGreaterThan(0)
    expect(gaps.every((gap) => gap.message.length > 0)).toBe(true)
    const mondays = january.openDays.filter((day) => day.weekDay === "monday")
    for (const monday of mondays) {
      expect(assignments[permanenceSlotKey(monday.date, "opening")]).toBeUndefined()
    }
  })

  it("reprend les repos des fiches, sans en inventer", () => {
    const roster = [
      member("Adeline", { daysOff: ["wednesday"] }),
      member("Bruno", { daysOff: ["wednesday"] }),
      member("Camille"),
    ]
    const { rest } = generatePermanenceMonth({ calendar: january, roster })

    expect(rest["2026-01-07"]).toEqual(["adeline", "bruno"])
    expect(rest["2026-01-08"]).toBeUndefined()
  })

  it("ne remplit rien quand personne ne participe", () => {
    const { assignments, gaps } = generatePermanenceMonth({ calendar: january, roster: [] })

    expect(assignments).toEqual({})
    expect(gaps).toHaveLength(january.openDays.length * 2)
  })
})
