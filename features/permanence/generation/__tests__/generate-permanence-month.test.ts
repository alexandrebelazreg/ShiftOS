import { describe, expect, it } from "vitest"

import type { IsoDate, WeekDay } from "@/features/core/models"
import { isoWeekKey } from "@/features/core/shared"
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
    canOpen: true,
    canClose: true,
    requiredOpeningDays: [],
    preferredOpeningDays: [],
    requiredClosingDays: [],
    preferredClosingDays: [],
    closingOnlyDays: [],
    maxClosings: null,
    lastResortOpening: false,
    lastResortClosing: false,
    saturdayTurnOver: false,
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

/** Les fermetures de cette personne, comptées semaine ISO par semaine ISO. */
function closingWeeks(
  assignments: Readonly<Record<string, string>>,
  employeeId: string
): ReadonlyMap<string, number> {
  const weeks = new Map<string, number>()
  for (const [key, id] of Object.entries(assignments)) {
    if (id !== employeeId || !key.endsWith("_closing")) continue
    const week = isoWeekKey(key.slice(0, key.lastIndexOf("_")))
    weeks.set(week, (weeks.get(week) ?? 0) + 1)
  }
  return weeks
}

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

  it("ne dépasse pas le maximum de fermetures d’UNE SEMAINE", () => {
    const roster = [
      member("Adeline", { maxClosings: 1 }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments, gaps } = generatePermanenceMonth({ calendar: january, roster })

    for (const [week, closings] of closingWeeks(assignments, "adeline")) {
      expect(closings, `semaine ${week}`).toBeLessThanOrEqual(1)
    }
    // Un plafond hebdomadaire n'est pas un plafond mensuel : sur cinq semaines,
    // elle ferme plusieurs fois dans le mois, une fois par semaine.
    expect(count(assignments, "adeline", "closing")).toBeGreaterThan(1)
    // Et il ne porte QUE sur les fermetures : elle continue d'ouvrir.
    expect(count(assignments, "adeline", "opening")).toBeGreaterThan(1)
    expect(gaps).toEqual([])
  })

  it("compte ce plafond sur la semaine, pas sur le passif de l’année", () => {
    // Sans quoi un plafond serait déjà épuisé en février par quelqu'un qui a
    // beaucoup fermé en janvier, et le réglage dirait tout autre chose.
    const roster = [member("Adeline", { maxClosings: 1 }), member("Bruno"), member("Camille")]
    const { assignments } = generatePermanenceMonth({
      calendar: january,
      roster,
      history: { adeline: { ...EMPTY_LOAD, closings: 10 } },
    })

    expect(count(assignments, "adeline", "closing")).toBeGreaterThan(0)
    for (const [, closings] of closingWeeks(assignments, "adeline")) {
      expect(closings).toBeLessThanOrEqual(1)
    }
  })

  it("n’attribue rien de ce qu’une fiche a retiré", () => {
    const roster = [
      member("Adeline", { canClose: false }),
      member("Bruno", { canOpen: false }),
      member("Camille"),
    ]
    const { assignments, gaps } = generatePermanenceMonth({ calendar: january, roster })

    expect(count(assignments, "adeline", "closing")).toBe(0)
    expect(count(assignments, "adeline", "opening")).toBeGreaterThan(0)
    expect(count(assignments, "bruno", "opening")).toBe(0)
    expect(count(assignments, "bruno", "closing")).toBeGreaterThan(0)
    expect(gaps).toEqual([])
  })

  it("laisse la case vide plutôt que d’appeler quelqu’un qui ne sait pas la tenir", () => {
    const roster = [member("Adeline", { canClose: false }), member("Bruno", { canClose: false })]
    const { assignments, gaps } = generatePermanenceMonth({ calendar: january, roster })

    expect(gaps).toHaveLength(january.openDays.length)
    expect(gaps.every((gap) => gap.role === "closing")).toBe(true)
    for (const day of january.openDays) {
      expect(assignments[permanenceSlotKey(day.date, "opening")]).toBeDefined()
    }
  })

  it("laisse un plafond de zéro dans le tour, pour les ouvertures seules", () => {
    const roster = [member("Adeline", { maxClosings: 0 }), member("Bruno"), member("Camille")]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })

    expect(count(assignments, "adeline", "closing")).toBe(0)
    expect(count(assignments, "adeline", "opening")).toBeGreaterThan(0)
  })

  it("ne fait fermer que les jours autorisés — et les lui donne tous", () => {
    // « Uniquement le lundi » dit deux choses à la fois : jamais un autre jour,
    // et bien celui-là. Lue comme une simple permission, la liste blanche
    // n'aurait servi qu'à retirer quelqu'un du tour.
    const roster = [
      member("Adeline", { closingOnlyDays: ["monday"] }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })
    const mondays = january.openDays.filter((day) => day.weekDay === "monday")

    for (const monday of mondays) {
      expect(assignments[permanenceSlotKey(monday.date, "closing")]).toBe("adeline")
    }
    expect(count(assignments, "adeline", "closing")).toBe(mondays.length)
  })

  it("respecte le plafond hebdomadaire même sur une liste blanche", () => {
    // Deux jours autorisés, un seul par semaine : le plafond tranche lequel,
    // et l'autre revient à quelqu'un d'autre.
    const roster = [
      member("Adeline", { closingOnlyDays: ["monday", "tuesday"], maxClosings: 1 }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })

    for (const [week, closings] of closingWeeks(assignments, "adeline")) {
      expect(closings, `semaine ${week}`).toBe(1)
    }
  })

  it("n’appelle le dernier recours que si personne d’autre ne peut", () => {
    const roster = [
      member("Adeline", { lastResortOpening: true, lastResortClosing: true }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })

    // Deux personnes ordinaires suffisent à tenir chaque journée : la réserve
    // n'est jamais ouverte.
    expect(count(assignments, "adeline", "closing")).toBe(0)
    expect(count(assignments, "adeline", "opening")).toBe(0)
  })

  it("ouvre la réserve plutôt que de laisser une case vide", () => {
    const roster = [member("Adeline", { lastResortOpening: true, lastResortClosing: true }), member("Bruno")]
    const { assignments, gaps } = generatePermanenceMonth({ calendar: january, roster })

    // Une seule personne ordinaire ne peut pas ouvrir ET fermer : sans le
    // dernier recours, une case sur deux resterait vide.
    expect(gaps).toEqual([])
    // La fermeture, plus contrainte, est servie en premier et revient à la
    // personne ordinaire ; la réserve prend ce qui reste.
    expect(count(assignments, "bruno", "closing")).toBeGreaterThan(0)
    expect(count(assignments, "adeline", "opening")).toBeGreaterThan(0)
  })

  it("sépare les deux réserves : ordinaire à l’ouverture, dépannage à la fermeture", () => {
    // La situation ordinaire d'un adjoint, et la raison d'être des deux
    // drapeaux : un seul aurait obligé à choisir entre les deux rôles.
    const roster = [
      member("Adeline", { lastResortClosing: true }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })

    expect(count(assignments, "adeline", "closing")).toBe(0)
    // À l'ouverture elle est traitée comme tout le monde : sa part y est pleine.
    expect(count(assignments, "adeline", "opening")).toBeGreaterThan(
      january.openDays.length / 4
    )
  })

  it("ne fait pas remonter un dernier recours par ses jours préférés", () => {
    // La réserve se partage AVANT le classement : la préférence départage à
    // l'intérieur d'un groupe, elle ne fait pas changer de groupe.
    const roster = [
      member("Adeline", {
        lastResortClosing: true,
        preferredClosingDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })

    expect(count(assignments, "adeline", "closing")).toBe(0)
  })

  it("dérange la réserve sur ses jours préférés d’abord, même si elle est plus chargée", () => {
    // Le seul endroit du générateur où une préférence l'emporte sur l'équité :
    // appeler quelqu'un qui n'est pas censé venir est déjà exceptionnel, alors
    // autant le déranger un jour qu'il a dit accepter. Bruno part avec dix
    // fermetures de passif — l'équité le désignerait en dernier, et il obtient
    // pourtant TOUS les lundis.
    const roster = [
      member("Adeline", { lastResortClosing: true }),
      member("Bruno", { lastResortClosing: true, preferredClosingDays: ["monday"] }),
      member("Camille", { canClose: false }),
    ]
    const { assignments } = generatePermanenceMonth({
      calendar: january,
      roster,
      history: { bruno: { ...EMPTY_LOAD, closings: 10 } },
    })
    const mondays = january.openDays.filter((day) => day.weekDay === "monday")

    for (const monday of mondays) {
      expect(assignments[permanenceSlotKey(monday.date, "closing")]).toBe("bruno")
    }
  })

  it("ne descend au jour non préféré de la réserve qu’à défaut", () => {
    // Les autres jours, personne ne les préfère : on retombe alors sur l'équité
    // ordinaire, et le passif de Bruno le fait passer après Adeline.
    const roster = [
      member("Adeline", { lastResortClosing: true }),
      member("Bruno", { lastResortClosing: true, preferredClosingDays: ["monday"] }),
      member("Camille", { canClose: false }),
    ]
    const { assignments, gaps } = generatePermanenceMonth({
      calendar: january,
      roster,
      history: { bruno: { ...EMPTY_LOAD, closings: 10 } },
    })

    // Aucune case perdue : le troisième groupe existe bien pour ça.
    expect(gaps).toEqual([])
    const tuesdays = january.openDays.filter((day) => day.weekDay === "tuesday")
    for (const tuesday of tuesdays) {
      expect(assignments[permanenceSlotKey(tuesday.date, "closing")]).toBe("adeline")
    }
  })

  it("tient les jours imposés d’un dernier recours — le réglage ne les annule pas", () => {
    const roster = [
      member("Adeline", { lastResortOpening: true, lastResortClosing: true, requiredClosingDays: ["monday"] }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })
    const mondays = january.openDays.filter((day) => day.weekDay === "monday")

    for (const monday of mondays) {
      expect(assignments[permanenceSlotKey(monday.date, "closing")]).toBe("adeline")
    }
    // Et rien d'autre : hors de ses lundis, la réserve reste fermée.
    expect(count(assignments, "adeline", "closing")).toBe(mondays.length)
  })

  it("n’use pas l’unique fermeuse à une ouverture", () => {
    // Trois personnes savent ouvrir, une seule sait fermer. Commencer par
    // l'ouverture consommerait la fermeuse — elle ouvrirait, et la fermeture
    // resterait vide alors qu'elle était tenable. Le rôle RARE passe d'abord.
    const roster = [
      member("Adeline"),
      member("Bruno", { canClose: false }),
      member("Camille", { canClose: false }),
    ]
    const { assignments, gaps } = generatePermanenceMonth({ calendar: january, roster })

    expect(gaps).toEqual([])
    for (const day of january.openDays) {
      expect(assignments[permanenceSlotKey(day.date, "closing")]).toBe("adeline")
      expect(assignments[permanenceSlotKey(day.date, "opening")]).not.toBe("adeline")
    }
  })

  it("équilibre les fermetures sans se laisser fausser par les ouvertures", () => {
    // Le défaut corrigé : comparer des charges TOUS RÔLES confondus écartait
    // des fermetures ceux qui ouvraient beaucoup, et les fermetures se
    // concentraient sur les autres. Chaque rôle se compare désormais à lui-même.
    const roster = [
      member("Adeline", { preferredOpeningDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })
    const closings = roster.map((person) => count(assignments, person.employeeId, "closing"))

    expect(spread(closings)).toBeLessThanOrEqual(1)
  })

  it("réserve les fermetures du samedi au tour de rôle, dès qu’il en existe un", () => {
    const roster = [
      member("Adeline", { saturdayTurnOver: true }),
      member("Bruno", { saturdayTurnOver: true }),
      member("Camille"),
      member("Denis"),
    ]
    const { assignments, gaps } = generatePermanenceMonth({ calendar: january, roster })
    const saturdays = january.openDays.filter((day) => day.weekDay === "saturday")

    expect(gaps).toEqual([])
    for (const saturday of saturdays) {
      expect(["adeline", "bruno"]).toContain(
        assignments[permanenceSlotKey(saturday.date, "closing")]
      )
    }
    // Et il tourne : cinq samedis pour deux personnes, à une près.
    const counts = ["adeline", "bruno"].map((id) => count(assignments, id, "closing", isSaturday))
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(5)
    expect(spread(counts)).toBeLessThanOrEqual(1)
  })

  it("ne change rien tant que personne n’est du tour de rôle", () => {
    // Un réglage que personne n'a touché ne doit rien changer : sans cette
    // règle, la case existerait et fermerait les samedis à tout le monde.
    const { assignments } = run()
    const saturdays = team.map((person) =>
      count(assignments, person.employeeId, "closing", isSaturday)
    )

    expect(saturdays.reduce((sum, value) => sum + value, 0)).toBe(5)
    expect(spread(saturdays)).toBeLessThanOrEqual(1)
  })

  it("laisse les samedis ouverts à tout le monde — le tour ne vise que la fermeture", () => {
    const roster = [
      member("Adeline", { saturdayTurnOver: true }),
      member("Bruno"),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })
    const saturdays = january.openDays.filter((day) => day.weekDay === "saturday")

    for (const saturday of saturdays) {
      expect(assignments[permanenceSlotKey(saturday.date, "opening")]).not.toBe("adeline")
    }
  })

  it("honore un samedi imposé même hors du tour de rôle", () => {
    // Une fiche qui impose un samedi est plus précise que l'appartenance à un
    // groupe : l'écraser en silence ferait mentir la fiche.
    const roster = [
      member("Adeline", { saturdayTurnOver: true }),
      member("Bruno", { requiredClosingDays: ["saturday"] }),
      member("Camille"),
    ]
    const { assignments } = generatePermanenceMonth({ calendar: january, roster })
    const saturdays = january.openDays.filter((day) => day.weekDay === "saturday")

    for (const saturday of saturdays) {
      expect(assignments[permanenceSlotKey(saturday.date, "closing")]).toBe("bruno")
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
