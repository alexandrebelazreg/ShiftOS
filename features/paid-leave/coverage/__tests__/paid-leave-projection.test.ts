import { describe, expect, it } from "vitest"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  buildPaidLeaveProjection,
  wishOneScenario,
  withRelaxedMinimums,
} from "@/features/paid-leave/coverage/paid-leave-projection"
import type { PaidLeaveCampaign, PaidLeaveWeekId } from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Ce que l'arbitrage coûte, mesuré.
 *
 * Le scénario de référence est toujours « chacun son premier vœu » : c'est la
 * demande brute de l'équipe, celle qu'on ne peut pas servir et qu'il faut
 * pouvoir chiffrer pour en discuter.
 */

const employee = (id: string, hours = 35): EmployeeRecord =>
  ({
    id,
    firstName: id,
    lastName: "Test",
    status: "active",
    sectors: ["Drive"],
    weeklyHours: hours,
    weeklyMinutes: hours * 60,
  }) as unknown as EmployeeRecord

const sectors: SectorDemandConfiguration[] = [
  { id: "drive", name: "Drive", status: "active" } as unknown as SectorDemandConfiguration,
]

const request = (wish1: PaidLeaveWeekId[]) => ({ employeeId: "x", wish1, wish2: [], wish3: [] })

/** Cinq personnes à 35 h : 175 h de base, un minimum à 140 laisse UN absent. */
function campaign(patch: Partial<PaidLeaveCampaign> = {}): PaidLeaveCampaign {
  const weeks: PaidLeaveWeekId[] = ["2026-W20", "2026-W21", "2026-W22"]
  return {
    id: "c1",
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 22 },
    requests: {},
    grants: {},
    employeeSettings: {},
    reinforcementPools: [],
    solution: null,
    coverage: {
      drive: Object.fromEntries(
        weeks.map((weekId) => [weekId, { minimumHours: 140, toleratedDeficitHours: 0 }])
      ),
    },
    ...patch,
  } as unknown as PaidLeaveCampaign
}

const team = ["a", "b", "c", "d", "e"].map((id) => employee(id))

const project = (patch: Partial<PaidLeaveCampaign> = {}) =>
  buildPaidLeaveProjection({ campaign: campaign(patch), employees: team, sectors })

describe("le scénario « chacun son premier vœu »", () => {
  it("ne retient que les semaines de la période, et jamais plus que le dû", () => {
    const scenario = wishOneScenario(
      campaign({ requests: { a: request(["2026-W20", "2026-W40"]) } }),
      [employee("a")]
    )

    // W40 est hors période : elle ne compte ni comme demandée, ni comme prise.
    expect(scenario.a).toEqual(["2026-W20"])
  })

  it("désigne les semaines qui ne tiennent pas, la plus tendue en tête", () => {
    // Trois personnes veulent W20, deux veulent W21. Le minimum n'autorise
    // qu'un absent : 70 h manquent sur W20, 35 h sur W21.
    const projection = project({
      requests: {
        a: request(["2026-W20"]),
        b: request(["2026-W20"]),
        c: request(["2026-W20"]),
        d: request(["2026-W21"]),
        e: request(["2026-W21"]),
      },
    })

    expect(projection.criticalWeeks.map((week) => [week.weekId, week.missingHours])).toEqual([
      ["2026-W20", 70],
      ["2026-W21", 35],
    ])
    expect(projection.criticalWeeks[0].wish1Requests).toBe(3)
  })

  it("chiffre le renfort qu’il faudrait pour que tout le monde soit servi", () => {
    const projection = project({
      requests: { a: request(["2026-W20"]), b: request(["2026-W20"]), c: request(["2026-W20"]) },
    })

    expect(projection.reinforcementNeededHours).toBe(70)
  })

  it("ne signale aucune semaine critique quand la demande passe", () => {
    const projection = project({ requests: { a: request(["2026-W20"]), b: request(["2026-W21"]) } })

    expect(projection.criticalWeeks).toEqual([])
    expect(projection.reinforcementNeededHours).toBe(0)
  })

  it("nomme la semaine la plus disputée, et se tait s’il n’y a pas de dispute", () => {
    const contested = project({
      requests: { a: request(["2026-W20"]), b: request(["2026-W20"]), c: request(["2026-W21"]) },
    })
    expect(contested.mostContested).toEqual({ weekId: "2026-W20", requests: 2 })

    const calm = project({ requests: { a: request(["2026-W20"]), b: request(["2026-W21"]) } })
    expect(calm.mostContested).toBeNull()
  })
})

describe("les enveloppes de renfort", () => {
  const pool = (patch: Record<string, unknown> = {}) => ({
    id: "p1",
    label: "Intérim été",
    totalHours: 100,
    startWeekId: "2026-W20",
    endWeekId: "2026-W22",
    scope: "global",
    sectorId: null,
    ...patch,
  })

  const contested = {
    requests: {
      a: request(["2026-W20"]),
      b: request(["2026-W20"]),
      c: request(["2026-W20"]),
    },
  }

  it("plafonne les heures mobilisables au besoin réel", () => {
    // 100 h budgétées pour 70 h de manque : le surplus n'est pas un renfort
    // mobilisable, c'est du budget qui restera.
    const projection = project({ ...contested, reinforcementPools: [pool()] as never })

    expect(projection.reinforcementNeededHours).toBe(70)
    expect(projection.reinforcementReachableHours).toBe(70)
    expect(projection.reinforcementMissingHours).toBe(0)
  })

  it("dit ce qui manquerait encore quand l’enveloppe ne suffit pas", () => {
    const projection = project({
      ...contested,
      reinforcementPools: [pool({ totalHours: 20 })] as never,
    })

    expect(projection.reinforcementMissingHours).toBe(50)
  })

  it("ignore une enveloppe dont la fenêtre n’atteint aucune semaine tendue", () => {
    // Du budget qui ne servira jamais — invisible tant qu'on ne regarde que
    // « combien reste-t-il ».
    const projection = project({
      ...contested,
      reinforcementPools: [pool({ startWeekId: "2026-W21", endWeekId: "2026-W22" })] as never,
    })

    expect(projection.reinforcementReachableHours).toBe(0)
    expect(projection.reinforcementMissingHours).toBe(70)
    expect(projection.pools[0].usefulOnCriticalWeeks).toBe(false)
  })

  it("ignore une enveloppe réservée à un autre rayon", () => {
    const projection = project({
      ...contested,
      reinforcementPools: [pool({ scope: "sector", sectorId: "caisse" })] as never,
    })

    expect(projection.pools[0].usefulOnCriticalWeeks).toBe(false)
  })

  it("dit si la proposition a consommé tout le budget", () => {
    const projection = project({
      ...contested,
      reinforcementPools: [pool({ totalHours: 20 })] as never,
      grants: { a: ["2026-W20"], b: ["2026-W20"], c: ["2026-W20"] },
    })

    // 70 h de manque, 20 h d'enveloppe : tout part.
    expect(projection.poolsFullyUsed).toBe(true)
    expect(projection.pools[0]).toMatchObject({ usedHours: 20, remainingHours: 0 })
  })

  it("signale un budget qui dort quand la proposition n’en a pas besoin", () => {
    const projection = project({
      requests: { a: request(["2026-W20"]), b: request(["2026-W21"]) },
      reinforcementPools: [pool()] as never,
      grants: { a: ["2026-W20"], b: ["2026-W21"] },
    })

    expect(projection.poolsFullyUsed).toBe(false)
    expect(projection.pools[0].remainingHours).toBe(100)
  })
})

describe("la satisfaction des vœux sur la proposition", () => {
  it("compte les semaines obtenues par rang", () => {
    const projection = project({
      requests: {
        a: { employeeId: "a", wish1: ["2026-W20"], wish2: ["2026-W21"], wish3: [] },
        b: { employeeId: "b", wish1: ["2026-W20"], wish2: ["2026-W21"], wish3: [] },
      } as never,
      grants: { a: ["2026-W20"], b: ["2026-W21"] },
    })

    expect(projection.satisfaction).toMatchObject({ rank1: 1, rank2: 1, rank3: 0, manual: 0 })
  })

  it("distingue une semaine posée à la main d’un vœu servi", () => {
    const projection = project({
      requests: { a: request(["2026-W20"]) },
      grants: { a: ["2026-W22"] },
    })

    expect(projection.satisfaction).toMatchObject({ rank1: 0, manual: 1 })
  })

  it("compte qui demandait et n’a rien obtenu", () => {
    const projection = project({
      requests: { a: request(["2026-W20"]), b: request(["2026-W20"]) },
      grants: { a: ["2026-W20"] },
    })

    expect(projection.satisfaction.unservedEmployees).toBe(1)
  })

  it("ne compte pas comme lésé quelqu’un qui ne demandait rien", () => {
    const projection = project({ requests: {}, grants: {} })

    expect(projection.satisfaction.unservedEmployees).toBe(0)
  })
})

describe("le coût du compromis, personne par personne", () => {
  it("compte les semaines de vœu 1 qu’il a fallu déplacer", () => {
    const projection = project({
      requests: {
        a: { employeeId: "a", wish1: ["2026-W20"], wish2: ["2026-W21"], wish3: [] },
      } as never,
      grants: { a: ["2026-W21"] },
    })

    expect(projection.compromises).toEqual([
      { employeeId: "a", name: "a Test", keptFromWish1: 0, movedWeeks: 1, worstRank: 2 },
    ])
  })

  it("ne compte pas comme perdu ce qui a été obtenu", () => {
    // Servi sur la semaine qu'il réclamait : aucun compromis, même si cette
    // semaine figure aussi dans un autre rang.
    const projection = project({
      requests: {
        a: { employeeId: "a", wish1: ["2026-W20"], wish2: ["2026-W20"], wish3: [] },
      } as never,
      grants: { a: ["2026-W20"] },
    })

    expect(projection.compromises).toEqual([])
  })

  it("met les plus touchés en tête", () => {
    const projection = project({
      requests: {
        a: { employeeId: "a", wish1: ["2026-W20"], wish2: [], wish3: [] },
        b: { employeeId: "b", wish1: ["2026-W20", "2026-W21"], wish2: [], wish3: [] },
      } as never,
      grants: { a: [], b: [] },
    })

    expect(projection.compromises.map((entry) => [entry.employeeId, entry.movedWeeks])).toEqual([
      ["b", 2],
      ["a", 1],
    ])
  })
})

describe("l’équité qui traverse les campagnes", () => {
  const settings = (id: string, firstChoiceHistory: number) => ({
    employeeId: id,
    priority: false,
    linkedEmployeeId: null,
    entryDate: "2020-01-01",
    firstChoiceHistory,
  })

  it("nomme ceux qui n’ont jamais eu leur vœu 1 et ne l’ont pas non plus", () => {
    // L'injustice d'une campagne se rattrape ; celle qui se répète, non.
    const projection = project({
      employeeSettings: { a: settings("a", 0), b: settings("b", 2) } as never,
      requests: {
        a: { employeeId: "a", wish1: ["2026-W20"], wish2: ["2026-W21"], wish3: [] },
        b: { employeeId: "b", wish1: ["2026-W21"], wish2: [], wish3: [] },
      } as never,
      grants: { a: ["2026-W21"], b: ["2026-W21"] },
    })

    expect(projection.neverFirstChoice.map((watch) => watch.employeeId)).toEqual(["a"])
    expect(projection.repeatedFirstChoice.map((watch) => watch.employeeId)).toEqual(["b"])
  })

  it("ne surveille que ceux qui demandaient quelque chose", () => {
    const projection = project({
      employeeSettings: { a: settings("a", 0) } as never,
      requests: {},
      grants: {},
    })

    expect(projection.neverFirstChoice).toEqual([])
  })

  it("ne compte au vœu 1 que celui qui est ENTIÈREMENT servi ainsi", () => {
    // Une semaine sur deux au premier vœu n'est pas « servi au premier vœu ».
    const projection = project({
      employeeSettings: { a: settings("a", 3) } as never,
      requests: {
        a: { employeeId: "a", wish1: ["2026-W20", "2026-W21"], wish2: ["2026-W22"], wish3: [] },
      } as never,
      grants: { a: ["2026-W20", "2026-W22"] },
    })

    expect(projection.repeatedFirstChoice).toEqual([])
  })
})

describe("le levier des minima", () => {
  const contested = {
    requests: {
      a: request(["2026-W20"]),
      b: request(["2026-W20"]),
      c: request(["2026-W20"]),
    },
  }

  it("dit à partir de quel palier la demande brute passe sans renfort", () => {
    // Trois absents sur W20 laissent 70 h présentes pour 140 requises : il faut
    // descendre le minimum de 70 h, donc le premier palier suffisant est 35 h…
    // non, 35 laisse encore 35 h de manque. Le balayage s'arrête donc sans
    // seuil, et le dit.
    const projection = project(contested)

    expect(projection.relief.map((step) => [step.deltaHours, step.criticalWeeks])).toEqual([
      [7, 1],
      [14, 1],
      [21, 1],
      [35, 1],
    ])
    expect(projection.reliefThresholdHours).toBeNull()
  })

  it("s’arrête au premier palier qui suffit", () => {
    // Deux absents : 105 h présentes pour 140 requises, 35 h de manque.
    // Retirer 35 h au minimum efface exactement la semaine critique.
    const projection = project({
      requests: { a: request(["2026-W20"]), b: request(["2026-W20"]) },
    })

    expect(projection.reliefThresholdHours).toBe(35)
    // Les paliers plus bas sont essayés, celui qui suffit clôt le balayage.
    expect(projection.relief.at(-1)).toEqual({
      deltaHours: 35,
      criticalWeeks: 0,
      reinforcementNeededHours: 0,
    })
  })

  it("décroît le besoin de renfort à mesure qu’on descend", () => {
    const projection = project({
      requests: { a: request(["2026-W20"]), b: request(["2026-W20"]) },
    })
    const needs = projection.relief.map((step) => step.reinforcementNeededHours)

    expect(needs).toEqual([...needs].sort((left, right) => right - left))
  })

  it("n’essaie aucun palier quand rien n’est critique", () => {
    const projection = project({ requests: { a: request(["2026-W20"]) } })

    expect(projection.reliefThresholdHours).toBe(7)
    expect(projection.relief).toEqual([
      { deltaHours: 7, criticalWeeks: 0, reinforcementNeededHours: 0 },
    ])
  })

  it("ne descend jamais un minimum sous zéro", () => {
    const relaxed = withRelaxedMinimums(campaign(), 500)

    expect(relaxed.coverage.drive["2026-W20"].minimumHours).toBe(0)
  })
})
