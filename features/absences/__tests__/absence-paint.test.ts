import { describe, expect, it } from "vitest"

import type { AbsenceMonthCell } from "@/features/absences/calendar/absence-month"
import { paintRange, QUICK_ENTRY_MOTIVES } from "@/features/absences/calendar/absence-paint"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"

/**
 * La saisie rapide : une plage glissée sur une ligne devient UNE absence, et
 * ne passe jamais par-dessus une absence déjà posée.
 */

const taken = { id: "x", employeeId: "1", type: "sick_leave", start: "", end: "" } as AbsenceRecord

/** Une ligne de sept jours ; `busy` liste les cases déjà occupées. */
function row(busy: readonly number[] = []): AbsenceMonthCell[] {
  return Array.from({ length: 7 }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    absence: busy.includes(index) ? taken : null,
    motiveLabel: null,
    half: null,
    locked: false,
  }))
}

describe("la plage peinte", () => {
  it("un clic sans glisser pose une seule journée", () => {
    expect(paintRange(row(), 2, 2)).toEqual({ from: 2, to: 2 })
  })

  it("couvre la plage dans les deux sens", () => {
    expect(paintRange(row(), 1, 4)).toEqual({ from: 1, to: 4 })
    expect(paintRange(row(), 4, 1)).toEqual({ from: 1, to: 4 })
  })

  it("s'arrête avant une absence déjà posée, au lieu de la recouvrir", () => {
    expect(paintRange(row([3]), 0, 6)).toEqual({ from: 0, to: 2 })
    expect(paintRange(row([3]), 6, 0)).toEqual({ from: 4, to: 6 })
  })

  it("ne commence pas sur une case occupée", () => {
    expect(paintRange(row([2]), 2, 5)).toBeNull()
  })
})

describe("les motifs de la saisie rapide", () => {
  it("écarte ceux qu'un clic ne sait pas décrire", () => {
    const values = QUICK_ENTRY_MOTIVES.map((motive) => motive.value)

    expect(values).toContain("training")
    expect(values).toContain("sick_leave")
    // Comptées en heures, ou sans sens sans leur précision écrite.
    expect(values).not.toContain("delegation")
    expect(values).not.toContain("other")
    // Déduit du calendrier des fériés, jamais saisi.
    expect(values).not.toContain("public_holiday")
  })
})
