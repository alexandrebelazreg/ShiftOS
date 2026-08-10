import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type { BoardShift, PlanningBoardInput } from "@/features/planning/board/model/board-input"
import {
  assessDayEdits,
  weeklyContractDeltas,
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

describe("badge — la semaine contre le contrat, jamais le jour affiché", () => {
  it("montre ± 0 quand la semaine tient le contrat", () => {
    // 480 min planifiées pour 480 min dues.
    const input = board([shift("s1", "e1", 540, 1020)])
    expect(weeklyContractDeltas(input).get(emp("e1"))).toEqual({
      kind: "unchanged",
      label: "± 0",
    })
  })

  it("montre le dépassement et le manque hebdomadaires", () => {
    expect(weeklyContractDeltas(board([shift("s1", "e1", 540, 1035)])).get(emp("e1"))).toEqual({
      kind: "extended",
      label: "+15 min",
    })
    expect(weeklyContractDeltas(board([shift("s1", "e1", 540, 1005)])).get(emp("e1"))).toEqual({
      kind: "reduced",
      label: "-15 min",
    })
  })

  it("ANNULE deux retouches opposées sur des jours différents", () => {
    // Le bug corrigé : +15 min mardi et -15 min jeudi affichaient « +15 min »
    // sur un onglet et « -15 min » sur l'autre, alors que la semaine de
    // l'intéressé n'avait pas bougé d'une minute.
    const tuesday = shift("s1", "e1", 540, 795) // 255 min
    const thursday = { ...shift("s2", "e1", 540, 765), date: "2026-07-23" } // 225 min
    const week = board([tuesday, thursday], [], [480, 480])
    expect(weeklyContractDeltas(week).get(emp("e1"))).toEqual({
      kind: "unchanged",
      label: "± 0",
    })
  })

  it("donne le même badge quel que soit le jour consulté", () => {
    // Une semaine n'est pas une propriété d'un jeudi : le badge ne prend aucune
    // date en argument, et c'est ce qui le rend stable d'un onglet à l'autre.
    const week = board([shift("s1", "e1", 540, 1035)])
    expect(weeklyContractDeltas(week)).toEqual(weeklyContractDeltas(week))
    expect(weeklyContractDeltas.length).toBe(1)
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

describe("verdict du jour — la couverture est une CONCURRENCE", () => {
  /**
   * Le bug vu à l'écran : « Couverture dégradée -1 présent (12:00 – 13:00) »
   * sur une heure où deux personnes étaient présentes de bout en bout.
   *
   * Erwan tient jusqu'à 12:15, Luca prend à 12:15, Dylan couvre l'heure
   * entière. Aucun shift ne couvre 12:00–13:00 à lui seul, donc l'ancien
   * comptage n'en voyait qu'un — et annonçait une dégradation sur une journée
   * qui n'avait rien perdu.
   */
  const THURSDAY = "2026-07-30"

  /**
   * Contracts are passed in and always match what the schedule works, so the
   * verdict can only ever be about COVERAGE. A fixture that leaves someone off
   * contract makes `assessDayEdits` answer "Écart contractuel" — a true verdict
   * about the wrong thing, and a test that would pass while proving nothing.
   */
  const day = (
    shifts: readonly BoardShift[],
    contracts: readonly [number, number, number]
  ): PlanningBoardInput => ({
    periodStart: THURSDAY,
    periodEnd: THURSDAY,
    sectors: [{ id: "all", name: "Tous" }],
    employees: [
      { id: emp("e1"), name: "Erwan", sectorIds: ["all"], contractMinutes: contracts[0], rules: [] },
      { id: emp("e2"), name: "Luca", sectorIds: ["all"], contractMinutes: contracts[1], rules: [] },
      { id: emp("e3"), name: "Dylan", sectorIds: ["all"], contractMinutes: contracts[2], rules: [] },
    ],
    days: [
      { date: THURSDAY, weekDay: "thursday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
    ],
    shifts,
    demand: [{ sectorId: "all", date: THURSDAY, startMinutes: 720, endMinutes: 780, requiredEmployees: 2 }],
  })

  const on = (id: string, employeeId: string, start: number, end: number): BoardShift => ({
    ...shift(id, employeeId, start, end),
    date: THURSDAY,
  })

  // Erwan tient jusqu'à 12:15, Luca prend le relais, Dylan couvre l'heure.
  const before = () => day([on("s1", "e1", 360, 735), on("s2", "e2", 735, 1200), on("s3", "e3", 585, 1020)], [375, 465, 435])

  it("ne crie pas à la dégradation quand une passation couvre l'heure", () => {
    // La passation glisse de 12:15 à 12:30 : deux présents partout, avant comme après.
    const after = day([on("s1", "e1", 360, 750), on("s2", "e2", 750, 1200), on("s3", "e3", 585, 1020)], [390, 450, 435])
    expect(assessDayEdits(before(), after, THURSDAY).kind).toBe("neutral")
  })

  it("signale une vraie dégradation quand un trou apparaît", () => {
    // Erwan part à 12:00, Luca n'arrive qu'à 12:30 : un seul présent entre les deux.
    const after = day([on("s1", "e1", 360, 720), on("s2", "e2", 750, 1200), on("s3", "e3", 585, 1020)], [360, 450, 435])
    expect(assessDayEdits(before(), after, THURSDAY).kind).toBe("degradation")
  })
})

describe("présence — une seule définition dans toute l'application", () => {
  it("ne réimplémente le comptage nulle part", () => {
    // Trois fichiers avaient chacun leur version, et deux d'entre elles
    // comptaient le recouvrement au lieu de la concurrence. Le symptôme était
    // le même écran affichant deux chiffres différents pour la même heure.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..")
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(full)
        return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : []
      })

    const offenders = walk(root).filter((file) => {
      const source = readFileSync(file, "utf8")
      // La signature du comptage par recouvrement : un segment qui doit
      // commencer avant ET finir après les deux bornes d'une fenêtre.
      return /startMinutes\s*<=\s*\w+\.startMinutes[\s\S]{0,120}endMinutes\s*>=\s*\w+\.endMinutes/.test(source)
    })
    expect(offenders.map((file) => file.replace(root, ""))).toEqual([])
  })
})
