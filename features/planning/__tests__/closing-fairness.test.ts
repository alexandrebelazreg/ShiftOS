import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import type { EmployeeId, IsoDate, WeekDay } from "@/features/core/models"
import { buildPlanningProblemV3, closingFairnessActive } from "@/features/core/planning-v3/problem-builder"
import { PLANNING_OBJECTIVES_V3 } from "@/features/core/planning-v3/types/problem"
import { compareClosingLoad, closingLoadSpreadPermille } from "@/features/core/planning-v3/fairness/closing-load"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { buildClosingHistory, type ClosingHistoryEntry } from "@/features/planning/closing-history/build-closing-history"
import type { PlanningRecord, PlanningStatus } from "@/features/planning/persistence/planning-record"
import { referenceInput, referenceSolution } from "@/features/core/planning-v3/__tests__/reference-scenario"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"
import {
  sectorStoreConfig,
  smallSector,
  smallSectorEmployees,
  SMALL_SECTOR_SCOPE,
} from "@/features/planning/__tests__/planning-fixtures"

/**
 * Closing fairness, from persisted weeks to the objective vector.
 *
 * The thing every one of these tests is really guarding: fairness is a
 * PREFERENCE. It may reorder who closes; it may never change how many slots are
 * covered, never make a problem infeasible, and never turn a legal schedule into
 * an illegal one.
 */

function brand<T>(value: string): T {
  return value as unknown as T
}

const MONDAY = "2026-06-01"
const SATURDAY = "2026-06-06"

interface WeekSpec {
  readonly id: string
  readonly status: PlanningStatus
  readonly sectorIds?: readonly string[]
  readonly periodStart: string
  readonly periodEnd: string
  /** date → employee who ends last that day. */
  readonly closers: Readonly<Record<string, string>>
  readonly employees?: readonly string[]
  readonly absences?: readonly { employeeId: string; start: string; end: string }[]
  readonly noClose?: readonly string[]
}

/** A persisted week, reduced to what the history actually reads. */
function week(spec: WeekSpec): PlanningRecord {
  const employees = spec.employees ?? ["alice", "bruno"]
  const dates = [...new Set(Object.keys(spec.closers))].sort()

  const shifts = dates.flatMap((date) =>
    employees.map((employeeId) => ({
      id: brand(`shift_${spec.id}_${date}_${employeeId}`),
      storeId: brand("store"),
      templateId: null,
      date: date as IsoDate,
      source: "dynamic" as const,
      // The closer of the day ends at 20:00; everyone else at 16:00. The history
      // reads "who finished last", so this is the whole signal.
      segments: [
        spec.closers[date] === employeeId
          ? { startTime: "12:00", endTime: "20:00" }
          : { startTime: "08:00", endTime: "16:00" },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }))
  )

  const assignments = shifts.map((shift) => ({
    id: brand(`a_${String(shift.id)}`),
    planningId: brand(spec.id),
    shiftId: shift.id,
    employeeId: brand(String(shift.id).split("_").pop()!),
    status: "confirmed" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }))

  const allDays: WeekDay[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

  return {
    id: spec.id,
    status: spec.status,
    label: spec.id,
    periodStart: spec.periodStart,
    periodEnd: spec.periodEnd,
    ...(spec.sectorIds === undefined ? {} : { sectorIds: spec.sectorIds }),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    savedAt: "2026-01-01T00:00:00.000Z",
    state: {
      shifts,
      assignments,
      coreInput: {
        store: {} as never,
        employees: employees.map((id) => ({
          id: brand<EmployeeId>(id),
          status: "active",
          capabilities: (spec.noClose ?? []).includes(id) ? [] : ["CAN_CLOSE"],
        })) as never,
        contracts: employees.map((id) => ({
          employeeId: brand<EmployeeId>(id),
          workingDays: allDays,
        })) as never,
        availabilityRules: [],
        absences: (spec.absences ?? []).map((absence) => ({
          employeeId: brand<EmployeeId>(absence.employeeId),
          range: { start: absence.start, end: absence.end },
        })) as never,
        employeeConstraints: [],
        holidays: [],
        demand: { requirements: [] } as never,
      },
      configuration: {} as never,
      planning: {} as never,
      settings: {} as never,
    } as never,
  }
}

const history = (records: readonly PlanningRecord[], overrides: Partial<Parameters<typeof buildClosingHistory>[0]> = {}) =>
  buildClosingHistory({
    records,
    sectorId: "drive",
    weekStart: "2026-06-08" as IsoDate,
    lookbackWeeks: 8,
    employeeIds: ["alice", "bruno"],
    minimumRestMinutes: 720,
    ...overrides,
  })

const of = (entries: readonly ClosingHistoryEntry[], id: string) =>
  entries.find((entry) => String(entry.employeeId) === id)!

describe("historique — ce qui compte et ce qui ne compte pas", () => {
  it("compte les fermetures d'une semaine publiée du bon secteur", () => {
    const result = history([
      week({ id: "w1", status: "published", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY, closers: { [MONDAY]: "alice", [SATURDAY]: "alice" } }),
    ])
    expect(of(result, "alice").closings).toBe(2)
    expect(of(result, "bruno").closings).toBe(0)
    // Une semaine vaut UNE PART, exprimée en cinquièmes : ces salariés ont six
    // jours au contrat, donc la part pleine. Compter les jours ferait dépendre
    // le dénominateur de la taille du contrat, ce que l'équité par semaine
    // existe précisément pour éviter.
    expect(of(result, "bruno").opportunities).toBe(5)
    expect(of(result, "alice").opportunities).toBe(5)
  })

  it("ignore un brouillon", () => {
    const result = history([
      week({ id: "w1", status: "draft", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY, closers: { [MONDAY]: "alice" } }),
    ])
    expect(of(result, "alice").closings).toBe(0)
    expect(of(result, "alice").opportunities).toBe(0)
  })

  it("compte une semaine archivée, qui a bien eu lieu", () => {
    const result = history([
      week({ id: "w1", status: "archived", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY, closers: { [MONDAY]: "alice" } }),
    ])
    expect(of(result, "alice").closings).toBe(1)
  })

  it("exclut la semaine en cours et toute semaine qui la chevauche", () => {
    const current = history(
      [week({ id: "w1", status: "published", sectorIds: ["drive"], periodStart: "2026-06-08", periodEnd: "2026-06-13", closers: { "2026-06-08": "alice" } })],
      { weekStart: "2026-06-08" as IsoDate }
    )
    expect(of(current, "alice").closings).toBe(0)
  })

  it("isole les secteurs", () => {
    const result = history([
      week({ id: "w1", status: "published", sectorIds: ["accueil"], periodStart: MONDAY, periodEnd: SATURDAY, closers: { [MONDAY]: "alice" } }),
    ])
    expect(of(result, "alice").closings).toBe(0)
  })

  it("exclut un enregistrement qui n'a jamais noté son secteur", () => {
    // Deviner l'attribuerait au hasard : les fermetures d'un secteur
    // fausseraient l'équité d'un autre.
    const result = history([
      week({ id: "w1", status: "published", periodStart: MONDAY, periodEnd: SATURDAY, closers: { [MONDAY]: "alice" } }),
    ])
    expect(of(result, "alice").closings).toBe(0)
  })

  it("respecte le nombre de semaines demandé", () => {
    // Semaine générée : 2026-06-08. Huit semaines de recul remontent au
    // 2026-04-13 ; deux semaines seulement au 2026-05-25.
    const old = week({ id: "old", status: "published", sectorIds: ["drive"], periodStart: "2026-04-20", periodEnd: "2026-04-25", closers: { "2026-04-20": "alice" } })
    const recent = week({ id: "recent", status: "published", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY, closers: { [MONDAY]: "alice" } })
    expect(of(history([old, recent], { lookbackWeeks: 8 }), "alice").closings).toBe(2)
    expect(of(history([old, recent], { lookbackWeeks: 2 }), "alice").closings).toBe(1)
    // Et une fenêtre plus courte que la plus ancienne semaine n'en garde aucune.
    expect(of(history([old], { lookbackWeeks: 2 }), "alice").closings).toBe(0)
  })

  it("ne compte pas un absent comme éligible", () => {
    const result = history([
      week({
        id: "w1", status: "published", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY,
        closers: { [MONDAY]: "alice", [SATURDAY]: "alice" },
        absences: [{ employeeId: "bruno", start: MONDAY, end: MONDAY }],
      }),
    ])
    // Absent le lundi seulement : la semaine lui restait ouverte, il pouvait
    // fermer les autres jours. Elle compte donc en entier — l'unité est la
    // semaine, et rogner la part pour une journée ferait revenir par la fenêtre
    // le comptage par jour qu'on vient d'écarter.
    expect(of(result, "bruno").opportunities).toBe(5)
    expect(of(result, "alice").opportunities).toBe(5)
  })

  it("ne compte pas une semaine où l'absence couvrait tout", () => {
    // Ce qui doit protéger un absent n'est pas de perdre une part de semaine,
    // c'est de n'en compter aucune : sans cela, revenir d'un arrêt d'un mois
    // ferait passer pour « en retard » de fermetures qu'on ne pouvait pas
    // prendre, et lui vaudrait toutes celles du retour.
    const result = history([
      week({
        id: "w1", status: "published", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY,
        closers: { [MONDAY]: "alice", [SATURDAY]: "alice" },
        absences: [{ employeeId: "bruno", start: MONDAY, end: SATURDAY }],
      }),
    ])
    expect(of(result, "bruno").opportunities).toBe(0)
    expect(of(result, "alice").opportunities).toBe(5)
  })

  it("ne compte pas comme éligible un salarié qui ne peut pas fermer", () => {
    const result = history([
      week({
        id: "w1", status: "published", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY,
        closers: { [MONDAY]: "alice" }, noClose: ["bruno"],
      }),
    ])
    expect(of(result, "bruno").opportunities).toBe(0)
  })

  it("compte une fermeture du samedi dans les DEUX historiques", () => {
    const result = history([
      week({ id: "w1", status: "published", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY, closers: { [SATURDAY]: "alice" } }),
    ])
    expect(of(result, "alice").closings).toBe(1)
    expect(of(result, "alice").saturdayClosings).toBe(1)
    // Le samedi se mesure comme le reste : une part par semaine où un samedi
    // était possible, et non une occasion par samedi.
    expect(of(result, "alice").saturdayOpportunities).toBe(5)
  })

  it("est déterministe et trié", () => {
    const records = [week({ id: "w1", status: "published", sectorIds: ["drive"], periodStart: MONDAY, periodEnd: SATURDAY, closers: { [MONDAY]: "bruno" } })]
    expect(history(records)).toEqual(history(records))
    expect(history(records).map((entry) => String(entry.employeeId))).toEqual(["alice", "bruno"])
  })
})

describe("charge de fermeture — comparée en entiers, jamais en flottants", () => {
  const load = (id: string, closings: number, opportunities: number) => ({
    employeeId: brand<EmployeeId>(id),
    closings,
    opportunities,
  })

  it("préfère le salarié historiquement le moins chargé", () => {
    // 1 sur 8 est plus léger que 4 sur 8.
    expect(compareClosingLoad(load("b", 1, 8), load("a", 4, 8))).toBeLessThan(0)
  })

  it("compare des ratios, pas des comptages bruts", () => {
    // 2 fermetures sur 2 occasions est PLUS lourd que 3 sur 8, alors que le
    // comptage brut dirait l'inverse.
    expect(compareClosingLoad(load("a", 2, 2), load("b", 3, 8))).toBeGreaterThan(0)
  })

  it("place devant tout le monde celui qui n'a jamais eu l'occasion", () => {
    expect(compareClosingLoad(load("neuf", 0, 0), load("a", 0, 8))).toBeLessThan(0)
  })

  it("départage de façon totale et stable", () => {
    expect(compareClosingLoad(load("a", 1, 2), load("b", 1, 2))).toBeLessThan(0)
    expect(compareClosingLoad(load("b", 1, 2), load("a", 1, 2))).toBeGreaterThan(0)
  })

  it("mesure l'écart en pour mille entiers", () => {
    expect(closingLoadSpreadPermille([load("a", 4, 8), load("b", 1, 8)])).toBe(375)
    expect(closingLoadSpreadPermille([load("a", 1, 2), load("b", 4, 8)])).toBe(0)
  })
})

describe("problème canonique — l'équité n'entre que lorsqu'elle sert", () => {
  const withFairness = (fairness: { balanceClosings: boolean; balanceSaturdayClosings: boolean } | null) => {
    const input = referenceInput()
    return {
      ...input,
      closingHistory: [
        { employeeId: brand<EmployeeId>("alice"), closings: 4, opportunities: 8, saturdayClosings: 2, saturdayOpportunities: 4 },
        { employeeId: brand<EmployeeId>("bruno"), closings: 1, opportunities: 8, saturdayClosings: 0, saturdayOpportunities: 4 },
      ],
      business: {
        ...input.business,
        sectors: (input.business?.sectors ?? []).map((sector) => ({
          ...sector,
          closingFairness: fairness === null ? null : { ...fairness, lookbackWeeks: 8 },
        })),
      },
    }
  }
  const build = (input: ReturnType<typeof withFairness>) => {
    const built = buildPlanningProblemV3(input)
    if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
    return built.problem
  }

  it("n'embarque aucun historique quand les deux balances sont éteintes", () => {
    const off = build(withFairness({ balanceClosings: false, balanceSaturdayClosings: false }))
    expect(off.closingHistory).toBeUndefined()
  })

  it("laisse une règle désactivée produire exactement le même problème qu'aucune règle", () => {
    // La seule différence est la politique elle-même, portée par `rules` ; la
    // question posée au solveur est identique, donc sa réponse doit l'être.
    const off = build(withFairness({ balanceClosings: false, balanceSaturdayClosings: false }))
    const none = build(withFairness(null))
    expect(off.closingHistory).toBeUndefined()
    expect(none.closingHistory).toBeUndefined()
    expect(off.employees).toEqual(none.employees)
    expect(off.demandSlots).toEqual(none.demandSlots)
    expect(off.employeeDays).toEqual(none.employeeDays)
  })

  it("embarque et trie l'historique dès qu'une balance est allumée", () => {
    const on = build(withFairness({ balanceClosings: true, balanceSaturdayClosings: false }))
    expect(on.closingHistory?.map((entry) => String(entry.employeeId))).toEqual(["alice", "bruno"])
  })

  it("ne fait entrer l'historique dans l'empreinte que lorsqu'il compte", () => {
    const off = build(withFairness({ balanceClosings: false, balanceSaturdayClosings: false }))
    const none = build(withFairness(null))
    // Politique éteinte et politique absente diffèrent par `rules`, donc par
    // l'empreinte — c'est voulu et visible — mais aucune des deux ne porte
    // d'historique.
    expect(fingerprintProblem(off)).not.toBe(fingerprintProblem(none))

    const on = build(withFairness({ balanceClosings: true, balanceSaturdayClosings: false }))
    const onOtherHistory = buildPlanningProblemV3({
      ...withFairness({ balanceClosings: true, balanceSaturdayClosings: false }),
      closingHistory: [
        { employeeId: brand<EmployeeId>("alice"), closings: 0, opportunities: 8, saturdayClosings: 0, saturdayOpportunities: 4 },
      ],
    })
    expect(onOtherHistory.ok).toBe(true)
    expect(fingerprintProblem(on)).not.toBe(fingerprintProblem(onOtherHistory.ok ? onOtherHistory.problem : on))
  })

  it("reste déterministe", () => {
    const input = withFairness({ balanceClosings: true, balanceSaturdayClosings: true })
    expect(fingerprintProblem(build(input))).toBe(fingerprintProblem(build(input)))
  })

  it("expose `closingFairnessActive` comme seule définition de « allumée »", () => {
    expect(closingFairnessActive(null)).toBe(false)
    expect(closingFairnessActive({ balanceClosings: false, balanceSaturdayClosings: false })).toBe(false)
    expect(closingFairnessActive({ balanceClosings: true, balanceSaturdayClosings: false })).toBe(true)
    expect(closingFairnessActive({ balanceClosings: false, balanceSaturdayClosings: true })).toBe(true)
  })
})

describe("ordre des objectifs", () => {
  it("classe la couverture avant l'équité, et le samedi avant l'équité générale", () => {
    const order = [...PLANNING_OBJECTIVES_V3]
    expect(order.indexOf("coverage-deficit")).toBe(0)
    expect(order.indexOf("saturday-closing-fairness")).toBeLessThan(order.indexOf("closing-fairness"))
    expect(order.indexOf("coverage-deficit")).toBeLessThan(order.indexOf("saturday-closing-fairness"))
    expect(order.indexOf("closing-fairness")).toBeLessThan(order.indexOf("preference-satisfaction"))
  })
})

describe("validateur — rapporte, ne juge pas", () => {
  const problemWith = (fairness: { balanceClosings: boolean; balanceSaturdayClosings: boolean }) => {
    const input = referenceInput()
    const built = buildPlanningProblemV3({
      ...input,
      closingHistory: [
        { employeeId: brand<EmployeeId>("alice"), closings: 4, opportunities: 8, saturdayClosings: 2, saturdayOpportunities: 4 },
        { employeeId: brand<EmployeeId>("bruno"), closings: 1, opportunities: 8, saturdayClosings: 0, saturdayOpportunities: 4 },
      ],
      business: {
        ...input.business,
        sectors: (input.business?.sectors ?? []).map((sector) => ({ ...sector, closingFairness: { ...fairness, lookbackWeeks: 8 } })),
      },
    })
    if (!built.ok) throw new Error(built.errors.map((error) => error.message).join(" | "))
    return built.problem
  }

  it("ne dégrade jamais la couverture ni la légalité", () => {
    const problem = problemWith({ balanceClosings: true, balanceSaturdayClosings: true })
    const report = validatePlanningSolutionV3(problem, referenceSolution(fingerprintProblem(problem)))
    expect(report.violations).toEqual([])
    expect(report.validHardConstraints).toBe(true)
    expect(report.underCoveredSlots).toBe(0)
    expect(report.requiresExplicitAcceptance).toBe(false)
  })

  it("rapporte les six chiffres demandés", () => {
    const problem = problemWith({ balanceClosings: true, balanceSaturdayClosings: true })
    const report = validatePlanningSolutionV3(problem, referenceSolution(fingerprintProblem(problem)))
    const messages = report.informations.map((entry) => entry.message).join("\n")
    expect(messages).toContain("fermetures sur")       // historique + occasions
    expect(messages).toContain("ajoutée(s) cette semaine")
    expect(messages).toContain("charge finale")
    expect(messages).toContain("samedi")
    expect(messages).toContain("avant génération")
    expect(messages).toContain("après")
  })

  it("ne laisse PAS le plafond réduire ce qu'on doit à quelqu'un", () => {
    // Le plafond borne ce qu'on peut DONNER, jamais ce qu'on DOIT. Il entrait
    // autrefois dans le dénominateur : dès qu'un salarié plafonné à une
    // fermeture l'avait prise, ses jours restants cessaient d'être des
    // occasions, sa charge devenait pleine, et il sortait de la file — alors
    // qu'il était justement celui qui devait rester devant pour se rapprocher
    // le plus possible de ceux qui en font deux.
    const problem = problemWith({ balanceClosings: true, balanceSaturdayClosings: false })
    const lineFor = (name: string, from: ReturnType<typeof validatePlanningSolutionV3>) =>
      from.informations.find((entry) => entry.message.startsWith(name))!.message

    const capped = {
      ...problem,
      employees: problem.employees.map((employee) => ({ ...employee, maximumClosings: 1 })),
    } as typeof problem
    const free = {
      ...problem,
      employees: problem.employees.map((employee) => ({ ...employee, maximumClosings: null })),
    } as typeof problem

    const withCap = validatePlanningSolutionV3(capped, referenceSolution(fingerprintProblem(capped)))
    const without = validatePlanningSolutionV3(free, referenceSolution(fingerprintProblem(free)))

    for (const name of ["alice", "bruno", "chloe", "dylan"]) {
      expect(lineFor(name, withCap), `le plafond a changé la charge de ${name}`).toBe(lineFor(name, without))
    }
  })

  it("mesure la semaine en cours comme il mesure les semaines passées", () => {
    // Les deux moitiés du même rapport. Calculées différemment, la charge
    // affichée changerait toute seule dès que cette semaine deviendrait de
    // l'historique — c'est exactement la panne qui a précédé.
    const problem = problemWith({ balanceClosings: true, balanceSaturdayClosings: false })
    const report = validatePlanningSolutionV3(problem, referenceSolution(fingerprintProblem(problem)))
    const dylan = report.informations.find((entry) => entry.message.startsWith("dylan"))!.message

    // dylan n'a aucun historique et ferme deux fois sur une semaine de part
    // pleine : deux fermetures pour cinq cinquièmes, soit 400 pour mille.
    expect(dylan).toContain("2 ajoutée(s) cette semaine")
    expect(dylan).toContain("charge finale 400 ‰")
  })

  it("dit, jour par jour, qui pouvait fermer et pourquoi les autres non", () => {
    // La question à laquelle rien ne répondait. Les totaux disent QUE la
    // répartition est celle-là ; seul le détail du jour dit POURQUOI — et sans
    // lui, un gérant qui voit le plus léger de son équipe ne rien recevoir ne
    // peut pas distinguer une contrainte réelle d'un défaut du moteur.
    const problem = problemWith({ balanceClosings: true, balanceSaturdayClosings: false })
    const report = validatePlanningSolutionV3(problem, referenceSolution(fingerprintProblem(problem)))
    const days = report.informations.filter((entry) => entry.rule === "closing-fairness-day")

    // Une ligne par jour ouvert, ni plus ni moins.
    expect(days).toHaveLength(problem.days.filter((day) => !day.closed).length)

    const monday = days[0].message
    expect(monday).toContain("Lundi")
    expect(monday).toMatch(/fermeture par |personne ne ferme/)
    // « Pouvaient aussi » est la ligne qui tranche : elle seule dit si le moteur
    // avait le choix. Son absence doit être dite, pas laissée au silence.
    expect(monday).toMatch(/Pouvaient aussi : |Personne d'autre ne pouvait fermer\./)
  })

  it("n'annonce pas un plafond « déjà atteint » un jour où il ne l'était pas", () => {
    // Le plafond est HEBDOMADAIRE. Dire « déjà atteint » un lundi laisserait
    // croire qu'il bloquait ce jour-là, alors que les fermetures ont pu être
    // prises le vendredi. La phrase doit nommer la semaine, pas le jour.
    const problem = problemWith({ balanceClosings: true, balanceSaturdayClosings: false })
    const report = validatePlanningSolutionV3(problem, referenceSolution(fingerprintProblem(problem)))
    const withCap = report.informations
      .filter((entry) => entry.rule === "closing-fairness-day")
      .map((entry) => entry.message)
      .filter((message) => message.includes("plafond"))

    expect(withCap.length, "aucun plafond dans ce scénario").toBeGreaterThan(0)
    for (const message of withCap) {
      expect(message).toContain("plafond hebdomadaire")
      expect(message).not.toContain("déjà atteint")
    }
  })

  it("ne dit rien du jour quand l'équité est éteinte", () => {
    const problem = problemWith({ balanceClosings: false, balanceSaturdayClosings: false })
    const report = validatePlanningSolutionV3(problem, referenceSolution(fingerprintProblem(problem)))
    expect(report.informations.filter((entry) => entry.rule === "closing-fairness-day")).toEqual([])
  })

  it("ne rapporte rien du tout quand l'équité est éteinte", () => {
    const problem = problemWith({ balanceClosings: false, balanceSaturdayClosings: false })
    const report = validatePlanningSolutionV3(problem, referenceSolution(fingerprintProblem(problem)))
    expect(report.informations.filter((entry) => entry.rule.endsWith("closing-fairness"))).toEqual([])
  })
})

describe("audit de migration — l'historique publié n'est jamais réécrit", () => {
  /**
   * Les nouvelles valeurs par défaut (`maximumContinuousDuration = 480`,
   * `maximumSplitsPerDay = 1`) s'appliquent aux GÉNÉRATIONS, pas au passé.
   *
   * La question n'est pas rhétorique : un planning publié dont la journée fait
   * dix heures d'un seul tenant serait illégal sous les règles d'aujourd'hui.
   * S'il était re-jugé, il deviendrait rétroactivement invalide et l'historique
   * d'équité s'effondrerait avec lui.
   */
  const illegalUnderTodaysRules = week({
    id: "ancien",
    status: "published",
    sectorIds: ["drive"],
    periodStart: MONDAY,
    periodEnd: SATURDAY,
    closers: { [MONDAY]: "alice" },
  })

  it("relit sans broncher une semaine publiée qui enfreindrait les règles actuelles", () => {
    // Une journée de 10 h en continu : légale à l'époque, refusée aujourd'hui.
    const stretched: PlanningRecord = {
      ...illegalUnderTodaysRules,
      state: {
        ...illegalUnderTodaysRules.state,
        shifts: illegalUnderTodaysRules.state.shifts.map((shift) => ({
          ...shift,
          segments: [{ startTime: "10:00", endTime: "20:00" }],
        })),
      } as never,
    }
    const result = history([stretched])
    expect(of(result, "alice").closings + of(result, "bruno").closings).toBeGreaterThan(0)
  })

  it("compte aussi une semaine publiée portant deux coupures dans la journée", () => {
    const doubleSplit: PlanningRecord = {
      ...illegalUnderTodaysRules,
      state: {
        ...illegalUnderTodaysRules.state,
        shifts: illegalUnderTodaysRules.state.shifts.map((shift) => ({
          ...shift,
          segments: [
            { startTime: "08:00", endTime: "11:00" },
            { startTime: "12:00", endTime: "15:00" },
            { startTime: "17:00", endTime: "20:00" },
          ],
        })),
      } as never,
    }
    // Trois segments = deux coupures, au-delà du maximum d'aujourd'hui. Le
    // module lit la fin la plus tardive et ne juge rien.
    expect(history([doubleSplit]).some((entry) => entry.closings > 0)).toBe(true)
  })

  it("ne fait entrer aucune règle de secteur dans la lecture de l'historique", () => {
    // La signature le dit à elle seule : ni `SectorDemandConfiguration`, ni
    // `SectorShiftRules`, ni `validateSectorDemand`. Rien de ce qui définit les
    // règles d'aujourd'hui ne peut atteindre une semaine d'hier.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "closing-history", "build-closing-history.ts"),
      "utf8"
    )
    for (const forbidden of ["SectorDemandConfiguration", "SectorShiftRules", "validateSectorDemand", "maximumContinuousDuration", "maximumSplitsPerDay"]) {
      expect(source).not.toContain(forbidden)
    }
  })
})

describe("le joint — l'historique arrive-t-il vraiment jusqu'au problème", () => {
  /**
   * Les deux côtés de ce joint étaient testés, le joint ne l'était pas — et il
   * était cassé. `buildClosingHistory` savait compter, le constructeur savait
   * embarquer, mais RIEN ne passait les semaines enregistrées au flux : les
   * tests écrivaient `closingHistory` à la main dans l'entrée du problème.
   * L'équité paraissait donc réglable et n'avait aucune matière ; tout le monde
   * ressortait à égalité, quelles que soient les semaines déjà publiées.
   *
   * Ce test part de là où part l'application : des enregistrements.
   */
  const sector = {
    ...smallSector(),
    closingFairness: { balanceClosings: true, balanceSaturdayClosings: false, lookbackWeeks: 8 },
  }

  // Une semaine publiée AVANT celle qu'on génère, où e1 a tout fermé.
  const published = week({
    id: "semaine-passee",
    status: "published",
    sectorIds: [sector.id],
    periodStart: "2026-06-29",
    periodEnd: "2026-07-05",
    employees: ["e1", "e2"],
    closers: {
      "2026-06-29": "e1",
      "2026-06-30": "e1",
      "2026-07-01": "e1",
      "2026-07-02": "e1",
      "2026-07-03": "e1",
    },
  })

  const prepare = (savedPlannings: readonly PlanningRecord[]) =>
    preparePlanningGeneration({
      store: sectorStoreConfig(),
      employees: smallSectorEmployees(),
      sectors: [sector],
      scope: SMALL_SECTOR_SCOPE,
      savedPlannings,
    })

  it("porte l'historique jusqu'à l'entrée du problème", () => {
    const prepared = prepare([published])
    expect(prepared.status).toBe("ready")
    if (prepared.status !== "ready") return

    const entries = prepared.generationInput.closingHistory ?? []
    expect(entries.length, "aucun historique n'a traversé le flux").toBeGreaterThan(0)

    // Le signal lui-même : celui qui a fermé toute la semaine passée doit
    // ressortir plus chargé que celui qui n'a jamais fermé. Une longueur non
    // nulle ne suffirait pas — un historique tout à zéro la satisferait aussi.
    const e1 = entries.find((entry) => String(entry.employeeId) === "e1")!
    const e2 = entries.find((entry) => String(entry.employeeId) === "e2")!
    expect(e1.closings).toBeGreaterThan(e2.closings)
    expect(e1.opportunities).toBeGreaterThan(0)
  })

  it("laisse tout le monde à égalité quand aucune semaine n'a encore été publiée", () => {
    // L'ancien comportement, désormais réservé au cas où il est vrai : un
    // magasin qui démarre n'a pas d'historique, et ce n'est pas une panne.
    const prepared = prepare([])
    expect(prepared.status).toBe("ready")
    if (prepared.status !== "ready") return
    for (const entry of prepared.generationInput.closingHistory ?? []) {
      expect(entry.closings).toBe(0)
    }
  })
})
