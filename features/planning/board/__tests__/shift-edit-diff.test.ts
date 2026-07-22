import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type { BoardShift, PlanningBoardInput } from "@/features/planning/board/model/board-input"
import {
  assessDayEdits,
  dayEmployeeDeltas,
  deltaLabel,
  describeLastEdit,
  editsBlockPersistence,
} from "@/features/planning/board/model/shift-edit-diff"

const emp = (id: string) => id as EmployeeId
const DATE = "2026-07-20"

function shift(id: string, employeeId: string, start: number, end: number): BoardShift {
  return {
    id,
    employeeId: emp(employeeId),
    sectorId: "all",
    date: DATE,
    startMinutes: start,
    endMinutes: end,
    workedMinutes: end - start,
    segments: [{ startMinutes: start, endMinutes: end }],
    opensDay: false,
    closesDay: false,
  }
}

/**
 * `contract` is the weekly minutes each of the two employees is owed. The
 * generated plan is built so that both meet it exactly, which is what makes an
 * edit — and only an edit — able to open a contract gap.
 */
function board(
  shifts: readonly BoardShift[],
  demand: PlanningBoardInput["demand"] = [],
  contract: readonly [number, number] = [480, 480]
): PlanningBoardInput {
  return {
    periodStart: DATE,
    periodEnd: "2026-07-26",
    sectors: [{ id: "all", name: "Tous" }],
    employees: [
      { id: emp("e1"), name: "Luca Zanuso", sectorIds: ["all"], contractMinutes: contract[0], rules: [] },
      { id: emp("e2"), name: "Valentin Calvo", sectorIds: ["all"], contractMinutes: contract[1], rules: [] },
    ],
    days: [
      { date: DATE, weekDay: "monday", closed: false, opensAtMinutes: 480, closesAtMinutes: 1200 },
    ],
    shifts,
    demand,
  }
}

describe("badge — durée, déplacement, inchangé", () => {
  it("montre le gain ou la perte de durée", () => {
    const original = board([shift("s1", "e1", 540, 780)])
    const edited = board([shift("s1", "e1", 540, 795)]) // +15 min
    const deltas = dayEmployeeDeltas(original, edited, DATE)
    expect(deltas.get(emp("e1"))).toEqual({ kind: "extended", label: "+15 min" })
  })

  it("montre un déplacement qui conserve la durée", () => {
    const original = board([shift("s1", "e1", 540, 780)])
    const edited = board([shift("s1", "e1", 570, 810)]) // moved +30, same 4 h
    expect(dayEmployeeDeltas(original, edited, DATE).get(emp("e1"))).toEqual({
      kind: "shifted",
      label: "Décalé +30 min",
    })
  })

  it("montre ± 0 pour un salarié intact", () => {
    const input = board([shift("s1", "e1", 540, 780)])
    expect(dayEmployeeDeltas(input, input, DATE).get(emp("e1"))).toEqual({
      kind: "unchanged",
      label: "± 0",
    })
  })
})

describe("verdict — écart contractuel", () => {
  // e1 contracted 240 min for the week; the generated plan gives exactly that.
  const contract = [240, 240] as const

  it("+15 min sur la durée → écart contractuel, pas Conforme", () => {
    const original = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], [], contract)
    const edited = board([shift("s1", "e1", 540, 795), shift("s2", "e2", 540, 780)], [], contract)
    const verdict = assessDayEdits(original, edited, DATE)
    expect(verdict.kind).toBe("contract")
    expect(verdict.label).toBe("Écart contractuel")
    expect(verdict.detail).toBe("Luca Zanuso : +15 min par rapport au contrat")
    expect(editsBlockPersistence(verdict)).toBe(true)
  })

  it("-30 min sur la durée → écart contractuel", () => {
    const original = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], [], contract)
    const edited = board([shift("s1", "e1", 540, 750), shift("s2", "e2", 540, 780)], [], contract)
    const verdict = assessDayEdits(original, edited, DATE)
    expect(verdict.kind).toBe("contract")
    expect(verdict.detail).toBe("Luca Zanuso : -30 min par rapport au contrat")
  })

  it("résume et liste quand plusieurs salariés sont hors contrat", () => {
    const original = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], [], contract)
    const edited = board([shift("s1", "e1", 540, 795), shift("s2", "e2", 540, 750)], [], contract)
    const verdict = assessDayEdits(original, edited, DATE)
    expect(verdict.kind).toBe("contract")
    expect(verdict.detail).toBe("2 salariés hors contrat")
    expect(verdict.deviations).toEqual([
      { name: "Luca Zanuso", label: "+15 min", deltaMinutes: 15 },
      { name: "Valentin Calvo", label: "-30 min", deltaMinutes: -30 },
    ])
  })
})

describe("verdict — priorité : le contrat l'emporte sur la couverture", () => {
  it("une amélioration de couverture ne masque pas un écart contractuel", () => {
    const contract = [240, 240] as const
    const demand = [{ sectorId: "all", date: DATE, startMinutes: 780, endMinutes: 840, requiredEmployees: 1 }]
    // The edit both extends e1 (breaking the contract) AND covers a new slot.
    const original = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], demand, contract)
    const edited = board([shift("s1", "e1", 540, 840), shift("s2", "e2", 540, 780)], demand, contract)
    expect(assessDayEdits(original, edited, DATE).kind).toBe("contract")
  })
})

describe("verdict — un déplacement ne crée pas d'écart contractuel", () => {
  it("reste sur la couverture, jamais sur le contrat, quand la durée tient", () => {
    const contract = [240, 240] as const
    const original = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], [], contract)
    const edited = board([shift("s1", "e1", 570, 810), shift("s2", "e2", 540, 780)], [], contract)
    const verdict = assessDayEdits(original, edited, DATE)
    expect(verdict.kind).not.toBe("contract")
    expect(verdict.kind).toBe("neutral")
  })
})

describe("verdict — retour exact au contrat après undo", () => {
  it("recalcule Conforme dès que les minutes rejoignent le contrat", () => {
    const contract = [240, 240] as const
    const original = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], [], contract)
    // While edited, e1 is off contract → blocked…
    const off = board([shift("s1", "e1", 540, 795), shift("s2", "e2", 540, 780)], [], contract)
    expect(assessDayEdits(original, off, DATE).kind).toBe("contract")
    // …undo brings the shift back to its generated minutes → recomputed clean.
    const restored = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], [], contract)
    const after = assessDayEdits(original, restored, DATE)
    expect(after.kind).toBe("neutral")
    expect(editsBlockPersistence(after)).toBe(false)
  })
})

describe("verdict — couverture, sous le contrat", () => {
  const contract = [240, 240] as const

  it("signale une amélioration quand les contrats tiennent", () => {
    const demand = [{ sectorId: "all", date: DATE, startMinutes: 540, endMinutes: 600, requiredEmployees: 2 }]
    // A pure move of e1 onto the uncovered slot; worked time (and contract) held.
    const original = board([shift("s1", "e1", 600, 840), shift("s2", "e2", 540, 780)], demand, contract)
    const edited = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], demand, contract)
    const verdict = assessDayEdits(original, edited, DATE)
    expect(verdict.kind).toBe("improvement")
    expect(verdict.detail).toBe("+1 présent (09:00 – 10:00)")
  })

  it("bloque avant tout sur un chevauchement", () => {
    const original = board([shift("s1", "e1", 540, 780), shift("s2", "e2", 540, 780)], [], contract)
    const edited = board(
      [shift("s1", "e1", 540, 780), shift("s3", "e1", 660, 900), shift("s2", "e2", 540, 780)],
      [],
      contract
    )
    expect(assessDayEdits(original, edited, DATE).kind).toBe("blocking")
  })
})

describe("delta — étiquette signée", () => {
  it("écrit le badge comme le mock", () => {
    expect(deltaLabel(0)).toBe("± 0")
    expect(deltaLabel(15)).toBe("+15 min")
    expect(deltaLabel(60)).toBe("+1 h")
    expect(deltaLabel(-30)).toBe("-30 min")
    expect(deltaLabel(90)).toBe("+1 h 30")
  })
})

describe("description de la dernière modification", () => {
  it("nomme le salarié, l'écart et la nouvelle fin", () => {
    const original = board([shift("s1", "e1", 540, 780)])
    const edited = board([shift("s1", "e1", 540, 810)])
    expect(describeLastEdit(original, edited, "s1")).toBe("Luca Zanuso (+30 min, fin à 13:30)")
  })
})
