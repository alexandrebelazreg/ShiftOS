import { describe, expect, it } from "vitest"

import { WEEK_DAYS, type WeekDay } from "@/features/core/models"
import type { PlanningGenerationInput } from "@/features/core/planning-generator/types/generation-input"
import type { SectorPlanningRules } from "@/features/core/planning-generator/types/business-pipeline"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import {
  buildHourlyProfile,
  createEmptySector,
  SECTOR_RULE_DEFAULTS,
  validateSectorDemand,
  type SectorDemandConfiguration,
} from "@/features/sectors"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"
import {
  SMALL_SECTOR_SCOPE,
  employee,
  sectorStoreConfig,
  smallSector,
  smallSectorEmployees,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"

import { referenceInput, referenceSolution, REFERENCE_DATES } from "@/features/core/planning-v3/__tests__/reference-scenario"

/**
 * Sector → « Contraintes avancées », end to end.
 *
 * The audit that opened this work found the engines already able to enforce
 * every one of these rules: the Python solvers read `maximumContinuousMinutes`,
 * `maximumSplitsPerDay`, `minimumSplitMinutes`, `minimumOpeningsPerDay`,
 * `exactClosingsPerDay` and `hardMinimumEmployees` today. What was missing was
 * upstream — the builder hardcoded them, so no screen could ever set them.
 *
 * These tests therefore live where the gap was: the sector configuration, the
 * translation into the canonical problem, and the validator that decides what
 * the rules mean.
 */

function sectorRulesOf(input: PlanningGenerationInput): SectorPlanningRules {
  return (input.business?.sectors ?? [])[0]
}

function withSector(patch: Partial<SectorPlanningRules>): PlanningGenerationInput {
  const input = referenceInput()
  return {
    ...input,
    business: {
      ...input.business,
      sectors: (input.business?.sectors ?? []).map((sector) => ({ ...sector, ...patch })),
    },
  }
}

function buildOk(input: PlanningGenerationInput): PlanningProblemV3 {
  const built = buildPlanningProblemV3(input)
  if (!built.ok) throw new Error(`Problème invalide : ${built.errors.map((error) => error.message).join(" | ")}`)
  return built.problem
}

/** The whole application chain, from a persisted sector to a canonical problem. */
function throughTheApplication(sector: SectorDemandConfiguration): PlanningProblemV3 {
  const prepared = preparePlanningGeneration({
    // Aucune semaine publiée : ces tests ne portent pas sur l'équité.
    savedPlannings: [],
    store: storeConfig(),
    employees: smallSectorEmployees(),
    sectors: [sector],
    scope: SMALL_SECTOR_SCOPE,
  })
  if (prepared.status === "error") {
    throw new Error(`Préparation impossible : ${prepared.errors.map((error) => error.message).join(" | ")}`)
  }
  return buildOk(prepared.generationInput)
}

describe("secteur — rétrocompatibilité", () => {
  it("conserve les budgets exacts d'un secteur historique comme le Drive", () => {
    const manual = {
      ...smallSector(),
      weeklyDistributionEnabled: true,
    }
    const problem = throughTheApplication(manual)
    const openDays = problem.days.filter((day) => !day.closed)

    expect(openDays.every((day) => day.budgetMode === undefined)).toBe(true)
  })

  it("construit des budgets non nuls sans pourcentages manuels sur un nouveau secteur", () => {
    const base = smallSector()
    const automatic = {
      ...base,
      weeklyDistributionEnabled: false,
      weeklyDistribution: Object.fromEntries(WEEK_DAYS.map((day) => [day, 0])) as Record<WeekDay, number>,
    }
    const problem = throughTheApplication(automatic)
    const openDays = problem.days.filter((day) => !day.closed)

    expect(openDays.every((day) => day.budgetMinutes > 0)).toBe(true)
    expect(openDays.every((day) => day.budgetMode === "target")).toBe(true)
    expect(openDays.reduce((sum, day) => sum + day.budgetMinutes, 0)).toBe(
      problem.employees.reduce((sum, employee) => sum + employee.contractMinutes, 0)
    )
    expect(problem.employeeDays.filter((day) => day.available).every((day) => day.mandatory)).toBe(true)
  })

  it("utilise les contrats complets des salariés prioritaires dans un rayon automatique", () => {
    const base = createEmptySector("fruits")
    const openDays = WEEK_DAYS.filter((day) => day !== "sunday")
    const sector: SectorDemandConfiguration = {
      ...base,
      name: "Fruits et légumes",
      hours: WEEK_DAYS.map((day) => ({
        day,
        closed: day === "sunday",
        opensAt: "07:00",
        closesAt: "20:00",
      })),
      coverage: {
        standardDay: "monday",
        profiles: Object.fromEntries(
          openDays.map((day) => [day, buildHourlyProfile("07:00", "20:00", 1)])
        ),
      },
      weeklyDistributionEnabled: false,
      shiftRules: {
        ...base.shiftRules,
        inheritMinimumShiftDuration: false,
        minimumShiftDuration: 240,
      },
    }
    const employees = [
      employee("secondaire", { weeklyMinutes: 2_100, sectors: ["Drive", sector.name], workingDays: openDays }),
      employee("prioritaire-1", {
        weeklyMinutes: 2_100,
        sectors: [sector.name],
        workingDays: openDays,
        // Seulement quatre heures possibles par jour : le pré-calcul doit
        // appliquer cette borne avant de remettre les contrats-rayon au MILP.
        earliestStartTime: "07:00",
        latestEndTime: "11:00",
      }),
      employee("prioritaire-2", { weeklyMinutes: 2_100, sectors: [sector.name, "Drive"], workingDays: openDays }),
      employee("prioritaire-3", { weeklyMinutes: 2_100, sectors: [sector.name], workingDays: openDays }),
      employee("secondaire-2", { weeklyMinutes: 2_100, sectors: ["Accueil", sector.name], workingDays: openDays }),
      employee("secondaire-3", { weeklyMinutes: 2_100, sectors: ["Drive", sector.name], workingDays: openDays }),
    ]
    const prepared = preparePlanningGeneration({
      // Aucune semaine publiée : ces tests ne portent pas sur l'équité.
      savedPlannings: [],
      store: sectorStoreConfig(),
      employees,
      sectors: [sector],
      scope: SMALL_SECTOR_SCOPE,
    })
    if (prepared.status === "error") {
      throw new Error(`Préparation impossible : ${prepared.errors.map((error) => error.message).join(" | ")}`)
    }

    const problem = buildOk(prepared.generationInput)
    const open = problem.days.filter((day) => !day.closed)

    expect(open).toHaveLength(6)
    expect(open.reduce((sum, day) => sum + day.budgetMinutes, 0)).toBe(3 * 35 * 60)
    expect(open.every((day) => day.budgetMode === "target")).toBe(true)
    expect(problem.employees.map((entry) => String(entry.id))).toEqual([
      "prioritaire-1",
      "prioritaire-2",
      "prioritaire-3",
    ])
    expect(problem.employees.reduce((sum, entry) => sum + entry.contractMinutes, 0)).toBe(3 * 35 * 60)
    expect(problem.employees.map((entry) => entry.contractMinutes)).toEqual([2_100, 2_100, 2_100])

    // A solo sector owns the complete contracts of employees who have it as
    // priority #1. Coverage is a target, so surplus contract hours remain legal
    // overcoverage instead of being hidden in reduced sector quotas.
    expect(prepared.coreInput.contracts.map((contract) => contract.weeklyMinutes)).toEqual([
      2_100,
      2_100,
      2_100,
    ])
    expect(prepared.weeklyTargets).toBeUndefined()
  })

  it("construit un problème identique quand le secteur ne déclare aucune règle avancée", () => {
    // Le cas « ancien secteur » : l'appelant précède le bloc et n'envoie rien.
    const legacy = buildOk(referenceInput())
    expect(sectorRulesOf(referenceInput()).maximumContinuousDuration).toBeUndefined()
    expect(legacy.rules.maximumContinuousMinutes).toBeNull()
    expect(legacy.rules.maximumSplitsPerDay).toBeNull()
    expect(legacy.rules.minimumOpeningsPerDay).toBe(1)
    expect(legacy.rules.exactClosingsPerDay).toBe(1)
    expect(legacy.rules.closingFairness).toBeNull()
    // Et il reste résoluble : le planning de référence est toujours légal.
    const report = validatePlanningSolutionV3(legacy, referenceSolution(fingerprintProblem(legacy)))
    expect(report.violations).toEqual([])
  })

  it("donne à un secteur créé aujourd'hui les valeurs en vigueur", () => {
    const rules = createEmptySector("s").shiftRules
    expect(rules.maximumDailyDuration).toBe(600)
    expect(rules.maximumContinuousDuration).toBe(480)
    expect(rules.minimumSplitDuration).toBe(45)
    expect(rules.maximumSplitDuration).toBe(90)
    expect(rules.maximumSplitsPerDay).toBe(1)
    expect(rules.minimumOpeningsPerDay).toBe(1)
    expect(rules.requiredClosingsPerDay).toBe(1)
    expect(rules.minimumRestMinutes).toBe(720)
    expect(createEmptySector("s").closingFairness.lookbackWeeks).toBe(8)
    // Aucun plancher par défaut : une règle qui peut REFUSER un planning ne
    // s'acquiert pas par inadvertance.
    expect(createEmptySector("s").minimumPresence).toEqual([])
  })
})

describe("secteur §1 — couverture opérationnelle", () => {
  it("impose un minimum dur pendant toute l'ouverture", () => {
    const base = smallSector()
    const problem = throughTheApplication({
      ...base,
      minimumPresence: [{ id: "p1", days: [], from: null, to: null, employees: 1 }],
    })
    const open = problem.demandSlots.filter((slot) => slot.date === "2026-07-06")
    expect(open.length).toBeGreaterThan(0)
    for (const slot of open) expect(slot.hardMinimumEmployees).toBe(1)
  })

  it("renforce le minimum sur une plage, sans toucher au reste de la journée", () => {
    const base = smallSector()
    const problem = throughTheApplication({
      ...base,
      minimumPresence: [
        { id: "p1", days: [], from: null, to: null, employees: 1 },
        { id: "p2", days: ["monday"], from: "10:00", to: "14:00", employees: 2 },
      ],
    })
    const monday = problem.demandSlots.filter((slot) => slot.date === "2026-07-06")
    const inside = monday.filter((slot) => slot.startMinutes >= 600 && slot.endMinutes <= 840)
    const outside = monday.filter((slot) => slot.endMinutes <= 600 || slot.startMinutes >= 840)
    expect(inside.length).toBeGreaterThan(0)
    expect(outside.length).toBeGreaterThan(0)
    for (const slot of inside) expect(slot.hardMinimumEmployees).toBe(2)
    for (const slot of outside) expect(slot.hardMinimumEmployees).toBe(1)
  })

  it("n'applique le renfort qu'aux jours qu'il désigne", () => {
    const base = smallSector()
    const problem = throughTheApplication({
      ...base,
      minimumPresence: [{ id: "p2", days: ["monday"], from: "10:00", to: "14:00", employees: 2 }],
    })
    const tuesday = problem.demandSlots.filter((slot) => slot.date === "2026-07-07")
    for (const slot of tuesday) expect(slot.hardMinimumEmployees).toBeUndefined()
  })

  it("n'applique aucun minimum en dehors de l'ouverture", () => {
    const base = smallSector()
    const problem = throughTheApplication({
      ...base,
      minimumPresence: [{ id: "p1", days: [], from: null, to: null, employees: 1 }],
    })
    // Le week-end est fermé : aucun créneau, donc aucun plancher à porter.
    const closedDates = problem.days.filter((day) => day.closed).map((day) => day.date)
    expect(closedDates.length).toBeGreaterThan(0)
    for (const date of closedDates) {
      expect(problem.demandSlots.filter((slot) => slot.date === date)).toEqual([])
    }
  })

  it("laisse le besoin de référence souple et distinct du plancher", () => {
    const base = smallSector()
    const problem = throughTheApplication({
      ...base,
      minimumPresence: [{ id: "p1", days: [], from: null, to: null, employees: 1 }],
    })
    const slot = problem.demandSlots[0]
    // Deux nombres, deux questions : la cible peut être manquée, le plancher non.
    expect(slot.requiredEmployees).toBeGreaterThanOrEqual(1)
    expect(slot.hardMinimumEmployees).toBe(1)
  })
})

describe("secteur §2 — durées et coupures 4 h / 8 h / 10 h", () => {
  it("porte les trois durées jusqu'au problème canonique", () => {
    const problem = buildOk(
      withSector({
        minimumShiftDuration: 240,
        maximumDailyDuration: 600,
        maximumContinuousDuration: 480,
      })
    )
    expect(problem.rules.minimumShiftMinutes).toBe(240)
    expect(problem.rules.maximumShiftMinutes).toBe(600)
    expect(problem.rules.maximumContinuousMinutes).toBe(480)
  })

  it("laisse le secteur être plus strict que le magasin, jamais plus permissif", () => {
    // Le magasin plafonne à 600 ; un secteur qui demande 480 gagne, un secteur
    // qui demande 900 reste tenu par le magasin.
    expect(buildOk(withSector({ maximumDailyDuration: 480 })).rules.maximumShiftMinutes).toBe(480)
    expect(buildOk(withSector({ maximumDailyDuration: 900 })).rules.maximumShiftMinutes).toBe(600)
  })

  it("refuse un continu supérieur à la journée", () => {
    const built = buildPlanningProblemV3(withSector({ maximumDailyDuration: 480, maximumContinuousDuration: 600 }))
    expect(built.ok).toBe(false)
    expect(built.ok ? [] : built.errors.map((error) => error.code)).toContain("continuous_exceeds_daily")
  })

  it("porte la coupure 45–90 et le maximum quotidien", () => {
    const problem = buildOk(
      withSector({ splitShiftAllowed: true, minimumSplitDuration: 45, maximumSplitDuration: 90, maximumSplitsPerDay: 1 })
    )
    expect(problem.rules.minimumSplitMinutes).toBe(45)
    expect(problem.rules.maximumSplitMinutes).toBe(90)
    expect(problem.rules.maximumSplitsPerDay).toBe(1)
  })

  it("garde la politique du magasin comme repli quand le secteur ne dit rien", () => {
    // `referenceInput` déclare une politique magasin sans coupure minimale.
    const problem = buildOk(referenceInput())
    expect(problem.rules.minimumSplitMinutes).toBeNull()
    expect(problem.rules.maximumSplitsPerDay).toBeNull()
  })
})

describe("secteur §3 — ouvertures et fermetures", () => {
  it("porte le minimum d'ouvertures et le nombre de fermetures par jour", () => {
    const problem = buildOk(withSector({ minimumOpeningsPerDay: 2, requiredClosingsPerDay: 1 }))
    expect(problem.rules.minimumOpeningsPerDay).toBe(2)
    expect(problem.rules.exactClosingsPerDay).toBe(1)
  })

  it("fait respecter le minimum d'ouvertures par le validateur", () => {
    const problem = buildOk(withSector({ minimumOpeningsPerDay: 2 }))
    const report = validatePlanningSolutionV3(problem, referenceSolution(fingerprintProblem(problem)))
    // Le planning de référence n'ouvre qu'à une personne par jour.
    expect(report.violations.map((violation) => violation.rule)).toContain("opening-count")
  })

  it("garde l'héritage des plafonds hebdomadaires : null hérite, 0 interdit", () => {
    const withCaps = withSector({ maximumOpeningsPerWeek: 3, maximumClosingsPerWeek: 3 })
    const inherited = buildOk({
      ...withCaps,
      employeeConstraints: (withCaps.employeeConstraints ?? []).filter(
        (constraint) => !(String(constraint.employeeId) === "dylan" && constraint.type === "MAX_CLOSINGS")
      ),
    })
    expect(inherited.employees.find((entry) => String(entry.id) === "dylan")!.maximumClosings).toBe(3)

    const banned = buildOk({
      ...withCaps,
      employeeConstraints: (withCaps.employeeConstraints ?? []).map((constraint) =>
        String(constraint.employeeId) === "dylan" && constraint.type === "MAX_CLOSINGS"
          ? { ...constraint, value: 0 }
          : constraint
      ),
    })
    expect(banned.employees.find((entry) => String(entry.id) === "dylan")!.maximumClosings).toBe(0)
  })
})

describe("secteur §5 — repos entre deux journées", () => {
  it("laisse le secteur fixer son propre repos", () => {
    expect(buildOk(withSector({ minimumRestMinutes: 660 })).rules.minimumRestMinutes).toBe(660)
  })

  it("retombe sur la règle du magasin quand le secteur n'en déclare pas", () => {
    // `referenceInput` fixe 720 dans les settings.
    expect(buildOk(referenceInput()).rules.minimumRestMinutes).toBe(720)
  })
})

describe("secteur §4 — équité des fermetures", () => {
  const solutionFor = (problem: PlanningProblemV3) => referenceSolution(fingerprintProblem(problem))

  it("ne change rien quand l'équité est désactivée", () => {
    const off = buildOk(withSector({ closingFairness: { balanceClosings: false, balanceSaturdayClosings: false, lookbackWeeks: 8 } }))
    const none = buildOk(referenceInput())
    const reportOff = validatePlanningSolutionV3(off, solutionFor(off))
    const reportNone = validatePlanningSolutionV3(none, solutionFor(none))
    expect(reportOff.violations).toEqual(reportNone.violations)
    expect(reportOff.violations).toEqual([])
  })

  it("rapporte l'équité générale quand elle est demandée", () => {
    const problem = buildOk(withSector({ closingFairness: { balanceClosings: true, balanceSaturdayClosings: false, lookbackWeeks: 8 } }))
    const report = validatePlanningSolutionV3(problem, solutionFor(problem))
    const fairness = report.informations.filter((entry) => entry.rule === "closing-fairness")
    // Une ligne par salarié pouvant fermer, plus la synthèse de l'écart.
    expect(fairness.length).toBeGreaterThan(1)
    expect(fairness.every((entry) => entry.severity === "information")).toBe(true)
    expect(fairness.some((entry) => entry.message.includes("Écart d'équité générale"))).toBe(true)
    // Jamais dans `violations` : ce tableau vide EST la légalité du planning.
    expect(report.violations).toEqual([])
  })

  it("rapporte le samedi séparément", () => {
    const problem = buildOk(withSector({ closingFairness: { balanceClosings: false, balanceSaturdayClosings: true, lookbackWeeks: 8 } }))
    const report = validatePlanningSolutionV3(problem, solutionFor(problem))
    const summaries = report.informations
      .filter((entry) => entry.message.startsWith("Écart"))
      .map((entry) => entry.rule)
    // Seule la balance demandée produit une synthèse ; les lignes par salarié
    // restent là pour expliquer le chiffre.
    expect(summaries).toEqual(["saturday-closing-fairness"])
    expect(report.violations).toEqual([])
    expect(REFERENCE_DATES).toContain("2026-07-25") // le samedi mesuré
  })

  it("ne dégrade jamais la couverture : l'équité n'est qu'une information", () => {
    const problem = buildOk(withSector({ closingFairness: { balanceClosings: true, balanceSaturdayClosings: true, lookbackWeeks: 8 } }))
    const report = validatePlanningSolutionV3(problem, solutionFor(problem))
    // Aucune entrée d'équité ne peut rendre un planning illégal ni exiger une
    // acceptation : ce serait transformer un objectif souple en contrainte.
    for (const entry of report.informations) {
      if (entry.rule.endsWith("closing-fairness")) {
        expect(entry.severity).toBe("information")
        expect(entry.requiresExplicitAcceptance ?? false).toBe(false)
      }
    }
    expect(report.requiresExplicitAcceptance).toBe(false)
    expect(report.validHardConstraints).toBe(true)
    expect(report.underCoveredSlots).toBe(0)
  })

  it("classe la couverture avant toute équité", () => {
    const problem = buildOk(referenceInput())
    const objectives = [...problem.objectives]
    expect(objectives.indexOf("coverage-deficit")).toBeLessThan(objectives.indexOf("closing-fairness"))
    expect(objectives.indexOf("coverage-deficit")).toBe(0)
  })
})

describe("secteur — validation du formulaire", () => {
  const validSector = (patch: Partial<SectorDemandConfiguration> = {}): SectorDemandConfiguration => {
    const base = smallSector()
    return { ...base, ...patch }
  }
  const paths = (sector: SectorDemandConfiguration) =>
    validateSectorDemand(sector, storeConfig()).map((issue) => issue.path)

  it("accepte un secteur aux valeurs en vigueur", () => {
    expect(paths(validSector())).toEqual([])
  })

  it("refuse un continu supérieur à la journée", () => {
    const sector = validSector()
    expect(
      paths({ ...sector, shiftRules: { ...sector.shiftRules, maximumContinuousDuration: 900 } })
    ).toContain("shiftRules.maximumContinuousDuration")
  })

  it("refuse une coupure minimale supérieure à la maximale", () => {
    const sector = validSector()
    expect(
      paths({ ...sector, shiftRules: { ...sector.shiftRules, splitShiftAllowed: true, minimumSplitDuration: 120, maximumSplitDuration: 90 } })
    ).toContain("shiftRules.minimumSplitDuration")
  })

  it("refuse un repos hors du pas de 15 minutes", () => {
    const sector = validSector()
    expect(
      paths({ ...sector, shiftRules: { ...sector.shiftRules, minimumRestMinutes: 700 } })
    ).toContain("shiftRules.minimumRestMinutes")
  })

  it("refuse une plage renforcée dont la fin précède le début", () => {
    expect(
      paths(validSector({ minimumPresence: [{ id: "p", days: ["saturday"], from: "18:30", to: "10:00", employees: 2 }] }))
    ).toContain("minimumPresence.p")
  })

  it("refuse un renfort à zéro personne", () => {
    expect(
      paths(validSector({ minimumPresence: [{ id: "p", days: [], from: null, to: null, employees: 0 }] }))
    ).toContain("minimumPresence.p")
  })

  it("refuse un historique d'équité vide", () => {
    expect(
      paths(validSector({ closingFairness: { balanceClosings: true, balanceSaturdayClosings: false, lookbackWeeks: 0 } }))
    ).toContain("closingFairness.lookbackWeeks")
  })

  it("accepte l'exemple Accueil : minimum 1 en continu, 2 le samedi 10:00–18:30", () => {
    expect(
      paths(
        validSector({
          minimumPresence: [
            { id: "continu", days: [], from: null, to: null, employees: 1 },
            { id: "samedi", days: ["saturday"], from: "10:00", to: "18:30", employees: 2 },
          ],
        })
      )
    ).toEqual([])
  })
})

describe("secteur — déterminisme", () => {
  it("produit deux fois la même empreinte pour la même configuration", () => {
    const sector = {
      ...smallSector(),
      minimumPresence: [{ id: "p1", days: [] as WeekDay[], from: null, to: null, employees: 1 }],
    }
    expect(fingerprintProblem(throughTheApplication(sector))).toBe(
      fingerprintProblem(throughTheApplication(sector))
    )
  })

  it("change d'empreinte dès qu'une règle avancée change", () => {
    const base = fingerprintProblem(buildOk(withSector({ maximumContinuousDuration: 480 })))
    const other = fingerprintProblem(buildOk(withSector({ maximumContinuousDuration: 420 })))
    expect(base).not.toBe(other)
  })

  it("distingue deux planchers différents", () => {
    const one = throughTheApplication({ ...smallSector(), minimumPresence: [{ id: "p", days: [], from: null, to: null, employees: 1 }] })
    const two = throughTheApplication({ ...smallSector(), minimumPresence: [{ id: "p", days: [], from: null, to: null, employees: 2 }] })
    expect(fingerprintProblem(one)).not.toBe(fingerprintProblem(two))
  })

  it("garde les jours de la semaine dans un ordre stable", () => {
    expect([...WEEK_DAYS]).toEqual(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])
  })

  it("expose les valeurs en vigueur une seule fois", () => {
    // Une seule source pour les défauts : deux copies dériveraient.
    expect(SECTOR_RULE_DEFAULTS.maximumContinuousDuration).toBe(480)
    expect(SECTOR_RULE_DEFAULTS.minimumRestMinutes).toBe(720)
  })
})

describe("horaires — le secteur décide, pas le magasin", () => {
  /**
   * Un secteur n'est pas une subdivision de l'emploi du temps de la surface de
   * vente : un Drive ouvre avant elle, un Accueil ferme après. Le builder
   * intersectait les deux fenêtres, ce qui rognait silencieusement tout secteur
   * plus large — les heures existaient dans la configuration et étaient
   * impossibles à planifier, sans rien à l'écran pour le dire.
   */
  const withHours = (opensAt: string, closesAt: string): PlanningGenerationInput => {
    const base = referenceInput()
    return {
      ...base,
      business: {
        ...base.business,
        sectors: (base.business?.sectors ?? []).map((sector) => ({
          ...sector,
          hours: WEEK_DAYS.map((day) => ({ day, closed: day === "sunday", opensAt, closesAt })),
        })),
      },
    }
  }

  it("ouvre AVANT le magasin quand le secteur le déclare", () => {
    // Le magasin ouvre à 06:00 dans la fixture ; le secteur à 05:00.
    const problem = buildOk(withHours("05:00", "20:00"))
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      expect(day.opensAtMinutes).toBe(300)
    }
  })

  it("ferme APRÈS le magasin quand le secteur le déclare", () => {
    // Le magasin ferme à 20:00 ; le secteur à 22:00.
    const problem = buildOk(withHours("06:00", "22:00"))
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      expect(day.closesAtMinutes).toBe(1_320)
    }
  })

  it("retombe sur le magasin quand le secteur ne déclare aucun horaire", () => {
    const base = referenceInput()
    const problem = buildOk({
      ...base,
      business: {
        ...base.business,
        // Un secteur qui ne déclare aucun horaire : le magasin reprend la main.
        sectors: (base.business?.sectors ?? []).map((sector) => {
          const withoutHours = { ...sector }
          delete (withoutHours as { hours?: unknown }).hours
          return withoutHours
        }),
      },
    })
    for (const day of problem.days.filter((entry) => !entry.closed)) {
      expect(day.opensAtMinutes).toBe(360)
      expect(day.closesAtMinutes).toBe(1_200)
    }
  })

  it("étend la fenêtre disponible des salariés d'autant", () => {
    // La conséquence qui compte : ces heures deviennent réellement planifiables.
    const problem = buildOk(withHours("05:00", "22:00"))
    for (const entry of problem.employeeDays.filter((item) => item.available)) {
      expect(entry.earliestStartMinutes).toBe(300)
      expect(entry.latestEndMinutes).toBe(1_320)
    }
  })
})
