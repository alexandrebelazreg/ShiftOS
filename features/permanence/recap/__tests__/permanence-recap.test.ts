import { describe, expect, it } from "vitest"

import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import {
  emptyPermanenceMonth,
  permanenceSlotKey,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"
import {
  buildPermanenceRecap,
  buildPermanenceYear,
} from "@/features/permanence/recap/permanence-recap"

function member(id: string, name: string): PermanenceMember {
  return {
    employeeId: id,
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
  }
}

const roster = [member("a", "Adeline"), member("b", "Bruno")]

function monthWith(
  month: number,
  entries: readonly (readonly [string, "opening" | "closing", string])[]
): PermanenceMonth {
  return {
    ...emptyPermanenceMonth(2026, month, "2026-01-01T00:00:00.000Z"),
    assignments: Object.fromEntries(
      entries.map(([date, role, employeeId]) => [permanenceSlotKey(date, role), employeeId])
    ),
  }
}

describe("le récapitulatif des permanences", () => {
  it("compte les fermetures, dont les samedis, et les dimanches effectués", () => {
    // 3 et 10 janvier 2026 sont des samedis, le 4 est un dimanche.
    const month = monthWith(1, [
      ["2026-01-03", "closing", "a"],
      ["2026-01-10", "closing", "a"],
      ["2026-01-05", "closing", "a"],
      ["2026-01-04", "opening", "a"],
      ["2026-01-06", "closing", "b"],
      ["2026-01-06", "opening", "a"],
    ])

    const recap = buildPermanenceRecap([month], roster)
    const adeline = recap.rows.find((row) => row.employeeId === "a")!

    expect(adeline.load.closings).toBe(3)
    expect(adeline.load.saturdayClosings).toBe(2)
    expect(adeline.load.sundays).toBe(1)
    expect(adeline.load.openings).toBe(2)
    expect(adeline.total).toBe(5)
  })

  it("détaille les fermetures par jour de la semaine, comme les colonnes de la feuille", () => {
    const month = monthWith(1, [
      ["2026-01-05", "closing", "a"],
      ["2026-01-12", "closing", "a"],
      ["2026-01-06", "closing", "b"],
    ])

    const rows = buildPermanenceRecap([month], roster).rows

    expect(rows.find((row) => row.employeeId === "a")!.load.closingsByDay.monday).toBe(2)
    expect(rows.find((row) => row.employeeId === "b")!.load.closingsByDay.tuesday).toBe(1)
    expect(rows.find((row) => row.employeeId === "b")!.load.closingsByDay.monday).toBe(0)
  })

  it("mesure l’écart entre le plus chargé et le moins chargé", () => {
    const month = monthWith(1, [
      ["2026-01-05", "closing", "a"],
      ["2026-01-06", "closing", "a"],
      ["2026-01-07", "closing", "a"],
      ["2026-01-08", "closing", "b"],
      ["2026-01-03", "closing", "a"],
    ])

    const recap = buildPermanenceRecap([month], roster)

    expect(recap.closingSpread).toBe(3)
    expect(recap.saturdaySpread).toBe(1)
    expect(recap.totals.closings).toBe(5)
  })

  it("additionne plusieurs mois sans les confondre", () => {
    const recap = buildPermanenceRecap(
      [
        monthWith(1, [["2026-01-05", "closing", "a"]]),
        monthWith(2, [["2026-02-02", "closing", "a"]]),
      ],
      roster
    )

    expect(recap.rows.find((row) => row.employeeId === "a")!.load.closings).toBe(2)
  })

  it("ignore les affectations qu’il ne sait pas lire, plutôt que de tomber", () => {
    const month: PermanenceMonth = {
      ...emptyPermanenceMonth(2026, 1, "2026-01-01T00:00:00.000Z"),
      assignments: {
        "2026-01-05_closing": "a",
        "2026-01-32_closing": "a",
        "pas-une-cle": "a",
        "2026-01-06_sieste": "a",
        // Une personne sortie du tour : sa case reste dans la feuille, mais
        // elle n'apparaît plus dans un récapitulatif où elle n'a pas de ligne.
        "2026-01-07_closing": "partie",
      },
    }

    const recap = buildPermanenceRecap([month], roster)

    expect(recap.totals.closings).toBe(1)
    expect(recap.rows).toHaveLength(2)
  })

  it("range l’année en douze colonnes et un total", () => {
    const rows = buildPermanenceYear(
      [
        monthWith(1, [
          ["2026-01-05", "closing", "a"],
          ["2026-01-03", "closing", "a"],
        ]),
        monthWith(3, [["2026-03-02", "closing", "b"]]),
      ],
      roster
    )

    const adeline = rows.find((row) => row.employeeId === "a")!
    expect(adeline.closingsByMonth).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(adeline.closings).toBe(2)
    expect(adeline.saturdayClosings).toBe(1)

    const bruno = rows.find((row) => row.employeeId === "b")!
    expect(bruno.closingsByMonth[2]).toBe(1)
    expect(bruno.closings).toBe(1)
  })

  it("rend une ligne par personne du tour, même sans une seule permanence", () => {
    const recap = buildPermanenceRecap([], roster)

    expect(recap.rows.map((row) => row.name)).toEqual(["Adeline", "Bruno"])
    expect(recap.closingSpread).toBe(0)
  })
})
