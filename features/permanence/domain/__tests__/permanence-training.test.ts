import { describe, expect, it } from "vitest"

import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import { awayOn } from "@/features/permanence/domain/permanence-edits"
import { trainingByDate, trainingDraft } from "@/features/permanence/domain/permanence-training"
import {
  emptyPermanenceMonth,
  permanenceSlotKey,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"

/**
 * Une formation posée depuis la feuille de permanence est une ABSENCE : elle
 * se lit dans les absences, et en s'y posant elle vide les cases du jour.
 */

const absence = (overrides: Partial<AbsenceRecord> & Pick<AbsenceRecord, "id">): AbsenceRecord => ({
  employeeId: "a",
  type: "training",
  start: "2026-01-06",
  end: "2026-01-06",
  status: "active",
  ...overrides,
})

describe("les formations vues depuis la permanence", () => {
  it("lit les absences au motif Formation, jour par jour", () => {
    const byDate = trainingByDate(
      [absence({ id: "f1", start: "2026-01-06", end: "2026-01-07" })],
      ["2026-01-05", "2026-01-06", "2026-01-07"]
    )

    expect(byDate.has("2026-01-05")).toBe(false)
    expect(byDate.get("2026-01-06")?.map((entry) => entry.employeeId)).toEqual(["a"])
    expect(byDate.get("2026-01-07")?.map((entry) => entry.employeeId)).toEqual(["a"])
  })

  it("ignore les autres motifs et les formations annulées", () => {
    const byDate = trainingByDate(
      [
        absence({ id: "m", type: "sick_leave" }),
        absence({ id: "x", employeeId: "b", status: "cancelled" }),
      ],
      ["2026-01-06"]
    )

    expect(byDate.size).toBe(0)
  })

  it("ne laisse retirer d’ici qu’une formation d’une seule journée, jamais prolongée", () => {
    const byDate = trainingByDate(
      [
        absence({ id: "un-jour" }),
        absence({ id: "trois-jours", employeeId: "b", start: "2026-01-05", end: "2026-01-07" }),
        absence({
          id: "prolongee",
          employeeId: "c",
          extensions: [{ previousEnd: "2026-01-05", newEnd: "2026-01-06", recordedOn: "2026-01-05" }],
        }),
      ],
      ["2026-01-06"]
    )

    const removable = Object.fromEntries(
      (byDate.get("2026-01-06") ?? []).map((entry) => [entry.absenceId, entry.removable])
    )
    expect(removable).toEqual({ "un-jour": true, "trois-jours": false, prolongee: false })
  })

  it("n’écrit qu’une fois le nom de quelqu’un qui a deux formations le même jour", () => {
    const byDate = trainingByDate([absence({ id: "f1" }), absence({ id: "f2" })], ["2026-01-06"])

    expect(byDate.get("2026-01-06")).toHaveLength(1)
  })

  it("écrit une vraie absence Formation d’une journée", () => {
    expect(trainingDraft("a", "2026-01-06")).toEqual({
      employeeId: "a",
      type: "training",
      start: "2026-01-06",
      end: "2026-01-06",
    })
  })
})

describe("partir en formation", () => {
  const month: PermanenceMonth = {
    ...emptyPermanenceMonth(2026, 1, "2026-01-01T00:00:00.000Z"),
    assignments: {
      [permanenceSlotKey("2026-01-06", "opening")]: "a",
      [permanenceSlotKey("2026-01-06", "closing")]: "b",
      [permanenceSlotKey("2026-01-07", "opening")]: "a",
    },
    rest: { "2026-01-06": ["a", "c"] },
  }

  it("vide les cases de la personne ce jour-là, et ce jour-là seulement", () => {
    const next = awayOn(month, "2026-01-06", "a")

    expect(next.assignments[permanenceSlotKey("2026-01-06", "opening")]).toBeUndefined()
    expect(next.assignments[permanenceSlotKey("2026-01-06", "closing")]).toBe("b")
    expect(next.assignments[permanenceSlotKey("2026-01-07", "opening")]).toBe("a")
    expect(next.rest["2026-01-06"]).toEqual(["c"])
  })
})
