import { describe, expect, it } from "vitest"

import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import {
  historyBefore,
  previousMonths,
} from "@/features/permanence/generation/fairness-window"
import {
  emptyPermanenceMonth,
  permanenceSlotKey,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"

/**
 * La mémoire du générateur : deux mois glissants, et rien d'autre. Le passif
 * plus ancien ne rattrape plus personne.
 */

const member = (id: string): PermanenceMember => ({
  employeeId: id,
  name: id,
  shortName: id,
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
})

/** Un mois où `employeeId` ferme un samedi. */
function monthWithSaturdayClosing(year: number, month: number, date: string, employeeId: string): PermanenceMonth {
  return {
    ...emptyPermanenceMonth(year, month, "2026-01-01T00:00:00.000Z"),
    assignments: { [permanenceSlotKey(date, "closing")]: employeeId },
  }
}

describe("la fenêtre d'équité", () => {
  it("remonte les deux mois précédents, à travers le changement d'année", () => {
    expect(previousMonths(2026, 12)).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 10 },
    ])
    expect(previousMonths(2027, 1)).toEqual([
      { year: 2026, month: 12 },
      { year: 2026, month: 11 },
    ])
    expect(previousMonths(2027, 2)).toEqual([
      { year: 2027, month: 1 },
      { year: 2026, month: 12 },
    ])
  })

  it("oublie ce qui est plus ancien que deux mois", () => {
    const roster = [member("corentin"), member("stephanie")]
    const sheets = [
      // Août : hors fenêtre pour décembre — ne compte plus.
      monthWithSaturdayClosing(2026, 8, "2026-08-01", "corentin"),
      // Octobre et novembre : dans la fenêtre.
      monthWithSaturdayClosing(2026, 10, "2026-10-03", "stephanie"),
      monthWithSaturdayClosing(2026, 11, "2026-11-07", "stephanie"),
    ]

    const history = historyBefore(sheets, 2026, 12, roster)

    expect(history.corentin.saturdayClosings).toBe(0)
    expect(history.stephanie.saturdayClosings).toBe(2)
  })

  it("ne regarde jamais le mois généré ni les suivants", () => {
    const roster = [member("a")]
    const sheets = [
      monthWithSaturdayClosing(2026, 12, "2026-12-05", "a"),
      monthWithSaturdayClosing(2027, 1, "2027-01-02", "a"),
    ]

    expect(historyBefore(sheets, 2026, 12, roster).a.saturdayClosings).toBe(0)
  })
})
