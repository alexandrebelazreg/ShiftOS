import { describe, expect, it } from "vitest"

import type { Constraint, ConstraintId, EmployeeId, IsoDate } from "@/features/core/models"
import { mapEmployeeConstraints } from "@/features/core/data-bridge/mappers"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import type { PlanningGenerationInput } from "@/features/core/planning-generator/types/generation-input"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type { PlanningRuleCodeV3 } from "@/features/core/planning-v3/types/validation"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { employeeRecord } from "@/features/core/data-bridge/__tests__/fixtures"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"
import {
  SMALL_SECTOR_SCOPE,
  smallSector,
  smallSectorEmployees,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"

import {
  REFERENCE_DATES,
  referenceInput,
  referenceSolution,
  withDay,
} from "@/features/core/planning-v3/__tests__/reference-scenario"

/**
 * The per-employee advanced constraints, end to end.
 *
 * Two halves, and both are needed. The BUILDER half proves the canonical
 * problem actually carries what the employee card declares — a constraint the
 * problem drops is a constraint no engine can honour, however well the engines
 * are written. The VALIDATOR half proves the rule bites: it is the one
 * implementation that decides what "legal" means, so a schedule it accepts is a
 * schedule ShiftOS will publish.
 *
 * Every case starts from the reference scenario, whose baseline schedule is
 * legal on every rule at once, and changes exactly one thing.
 */

const [MONDAY] = REFERENCE_DATES

function brand<T>(value: string): T {
  return value as unknown as T
}

function bound(employeeId: string, type: "EARLIEST_START" | "LATEST_END", minutes: number): Constraint {
  return {
    id: brand<ConstraintId>(`${type}_${employeeId}`),
    employeeId: brand<EmployeeId>(employeeId),
    type,
    value: minutes,
  }
}

function inputWith(mutate: (input: PlanningGenerationInput) => PlanningGenerationInput) {
  return mutate(referenceInput())
}

function buildOk(input: PlanningGenerationInput): PlanningProblemV3 {
  const built = buildPlanningProblemV3(input)
  if (!built.ok) {
    throw new Error(`Problème V3 invalide : ${built.errors.map((error) => error.message).join(" | ")}`)
  }
  return built.problem
}

/** Adds employee constraints on top of the reference ones. */
function withConstraints(...added: Constraint[]): PlanningGenerationInput {
  return inputWith((input) => ({
    ...input,
    employeeConstraints: [...(input.employeeConstraints ?? []), ...added],
  }))
}

function withCapabilities(
  employeeId: string,
  mutate: (capabilities: readonly string[]) => readonly string[]
): PlanningGenerationInput {
  return inputWith((input) => ({
    ...input,
    employees: input.employees.map((employee) =>
      String(employee.id) === employeeId
        ? { ...employee, capabilities: [...mutate(employee.capabilities)] as typeof employee.capabilities }
        : employee
    ),
  }))
}

function withSector(patch: Record<string, unknown>): PlanningGenerationInput {
  return inputWith((input) => ({
    ...input,
    business: {
      ...input.business,
      sectors: (input.business?.sectors ?? []).map((sector) => ({ ...sector, ...patch })),
    },
  }))
}

function entriesOf(problem: PlanningProblemV3, employeeId: string) {
  const openDates = new Set(problem.days.filter((day) => !day.closed).map((day) => day.date))
  return problem.employeeDays.filter(
    (entry) => String(entry.employeeId) === employeeId && openDates.has(entry.date)
  )
}

function employeeOf(problem: PlanningProblemV3, employeeId: string) {
  return problem.employees.find((employee) => String(employee.id) === employeeId)!
}

/** The distinct blocking rules a schedule breaks, sorted for stable comparison. */
function brokenRules(problem: PlanningProblemV3, solution: PlanningSolutionV3): PlanningRuleCodeV3[] {
  const report = validatePlanningSolutionV3(problem, solution)
  return [...new Set(report.violations.map((violation) => violation.rule))].sort()
}

/** The legal baseline, re-fingerprinted for whichever problem it answers. */
function baselineFor(problem: PlanningProblemV3): PlanningSolutionV3 {
  return referenceSolution(fingerprintProblem(problem))
}

/**
 * Alice's Monday, cut in two. Same 270 minutes, same day, both halves on the
 * 15-minute step and separated by a 60-minute gap — so the only thing the
 * validator can object to is the cut itself.
 */
function splitMonday(problem: PlanningProblemV3): PlanningSolutionV3 {
  return withDay(baselineFor(problem), "alice", MONDAY as IsoDate, [
    { startMinutes: 360, endMinutes: 495 },
    { startMinutes: 555, endMinutes: 690 },
  ])
}

describe("problème canonique — restrictions horaires individuelles", () => {
  it("interdit de commencer avant l'heure déclarée, tous les jours ouverts", () => {
    const problem = buildOk(withConstraints(bound("alice", "EARLIEST_START", 600)))
    for (const entry of entriesOf(problem, "alice")) {
      expect(entry.earliestStartMinutes).toBe(600)
    }
    // Personne d'autre n'est touché : la borne appartient à la personne.
    for (const entry of entriesOf(problem, "bruno")) {
      expect(entry.earliestStartMinutes).toBe(360)
    }
  })

  it("interdit de finir après l'heure déclarée, tous les jours ouverts", () => {
    const problem = buildOk(withConstraints(bound("alice", "LATEST_END", 1_080)))
    for (const entry of entriesOf(problem, "alice")) {
      expect(entry.latestEndMinutes).toBe(1_080)
    }
    for (const entry of entriesOf(problem, "bruno")) {
      expect(entry.latestEndMinutes).toBe(1_200)
    }
  })

  it("rétrécit d'autant le maximum journalier", () => {
    // Une personne qui ne peut pas commencer avant 15:00 dans un secteur qui
    // ferme à 20:00 ne peut pas faire dix heures : le plafond doit le dire,
    // sinon un moteur propose une journée qu'aucune heure de début ne produit.
    const problem = buildOk(withConstraints(bound("alice", "EARLIEST_START", 900)))
    for (const entry of entriesOf(problem, "alice")) {
      expect(entry.maximumMinutes).toBe(300)
    }
    for (const entry of entriesOf(problem, "bruno")) {
      expect(entry.maximumMinutes).toBe(600)
    }
  })

  it("ne peut jamais élargir la fenêtre du secteur", () => {
    const problem = buildOk(
      withConstraints(
        bound("alice", "EARLIEST_START", 300), // 05:00, avant l'ouverture
        bound("alice", "LATEST_END", 1_320) // 22:00, après la fermeture
      )
    )
    for (const entry of entriesOf(problem, "alice")) {
      expect(entry.earliestStartMinutes).toBe(360)
      expect(entry.latestEndMinutes).toBe(1_200)
    }
  })

  it("refuse des bornes contradictoires plutôt que de deviner", () => {
    const built = buildPlanningProblemV3(
      withConstraints(
        bound("alice", "EARLIEST_START", 1_080),
        bound("alice", "LATEST_END", 600)
      )
    )
    expect(built.ok).toBe(false)
    expect(built.ok ? [] : built.errors.map((error) => error.code)).toContain(
      "individual_window_empty"
    )
  })

  it("refuse une borne qui ne laisse aucune plage dans les horaires du secteur", () => {
    const built = buildPlanningProblemV3(withConstraints(bound("alice", "EARLIEST_START", 1_200)))
    expect(built.ok).toBe(false)
    expect(built.ok ? [] : built.errors.map((error) => error.code)).toContain(
      "individual_window_outside_opening"
    )
  })
})

describe("problème canonique — ouvertures, fermetures et coupures", () => {
  it("porte l'incapacité à ouvrir", () => {
    const problem = buildOk(referenceInput())
    expect(employeeOf(problem, "dylan").canOpen).toBe(false)
    expect(employeeOf(problem, "alice").canOpen).toBe(true)
  })

  it("porte l'incapacité à fermer", () => {
    const problem = buildOk(withCapabilities("alice", (keys) => keys.filter((key) => key !== "CAN_CLOSE")))
    expect(employeeOf(problem, "alice").canClose).toBe(false)
    expect(employeeOf(problem, "bruno").canClose).toBe(true)
  })

  it("porte l'autorisation de coupure, refusée par défaut", () => {
    expect(employeeOf(buildOk(referenceInput()), "alice").canSplitShift).toBe(false)
    const problem = buildOk(withCapabilities("alice", (keys) => [...keys, "CAN_SPLIT_SHIFT"]))
    expect(employeeOf(problem, "alice").canSplitShift).toBe(true)
  })

  it("porte les plafonds individuels d'ouvertures et de fermetures", () => {
    const problem = buildOk(referenceInput())
    expect(employeeOf(problem, "alice").maximumOpenings).toBe(4)
    expect(employeeOf(problem, "bruno").maximumClosings).toBe(1)
  })
})

/**
 * The inheritance rule, stated once and tested on every branch.
 *
 * `null` and `0` are the two values a truthy test cannot tell apart, and they
 * mean opposite things: `null` is "this person said nothing, ask the sector",
 * `0` is "this person may never open". A `||` here would silently promote every
 * total ban into the sector's default, which is the most permissive reading of
 * the strictest instruction anyone can give. Hence `??`, and hence a case per
 * branch below.
 */
describe("problème canonique — héritage des limites du secteur", () => {
  /** Sets one employee's individual cap, or removes it when `value` is null. */
  function withIndividualCap(
    employeeId: string,
    type: "MAX_OPENINGS" | "MAX_CLOSINGS",
    value: number | null
  ): PlanningGenerationInput {
    return inputWith((input) => {
      const others = (input.employeeConstraints ?? []).filter(
        (constraint) =>
          !(String(constraint.employeeId) === employeeId && constraint.type === type)
      )
      if (value === null) return { ...input, employeeConstraints: others }
      return {
        ...input,
        employeeConstraints: [
          ...others,
          { id: brand<ConstraintId>(`${type}_${employeeId}`), employeeId: brand<EmployeeId>(employeeId), type, value },
        ],
      }
    })
  }

  /** The four inheritance branches, as a table: [individuel, secteur] → attendu. */
  const BRANCHES: readonly {
    readonly individual: number | null
    readonly sector: number | null
    readonly expected: number | null
    readonly label: string
  }[] = [
    { individual: null, sector: 3, expected: 3, label: "null hérite du secteur" },
    { individual: 0, sector: 3, expected: 0, label: "zéro remplace le secteur" },
    { individual: 2, sector: 3, expected: 2, label: "une valeur remplace le secteur" },
    { individual: null, sector: null, expected: null, label: "rien nulle part reste sans plafond" },
    { individual: 0, sector: null, expected: 0, label: "zéro seul reste zéro" },
    { individual: 5, sector: 3, expected: 5, label: "une valeur au-dessus du secteur est respectée" },
  ]

  for (const branch of BRANCHES) {
    it(`ouvertures — ${branch.label}`, () => {
      const withCap = withIndividualCap("alice", "MAX_OPENINGS", branch.individual)
      const problem = buildOk({
        ...withCap,
        business: {
          ...withCap.business,
          sectors: (withCap.business?.sectors ?? []).map((sector) => ({
            ...sector,
            maximumOpeningsPerWeek: branch.sector,
          })),
        },
      })
      expect(employeeOf(problem, "alice").maximumOpenings).toBe(branch.expected)
    })

    it(`fermetures — ${branch.label}`, () => {
      const withCap = withIndividualCap("alice", "MAX_CLOSINGS", branch.individual)
      const problem = buildOk({
        ...withCap,
        business: {
          ...withCap.business,
          sectors: (withCap.business?.sectors ?? []).map((sector) => ({
            ...sector,
            maximumClosingsPerWeek: branch.sector,
          })),
        },
      })
      expect(employeeOf(problem, "alice").maximumClosings).toBe(branch.expected)
    })
  }

  it("ne confond jamais « zéro » et « rien » — le piège d'une logique truthy", () => {
    // Le test de non-régression littéral : sous `||`, les deux lignes suivantes
    // rendraient 3 toutes les deux, et un salarié interdit d'ouverture ouvrirait
    // trois fois par semaine.
    const sector = { maximumOpeningsPerWeek: 3, maximumClosingsPerWeek: 3 }
    const banned = buildOk({
      ...withIndividualCap("alice", "MAX_OPENINGS", 0),
      business: {
        ...referenceInput().business,
        sectors: (referenceInput().business?.sectors ?? []).map((entry) => ({ ...entry, ...sector })),
      },
      employeeConstraints: withIndividualCap("alice", "MAX_OPENINGS", 0).employeeConstraints,
    })
    const silent = buildOk({
      ...withIndividualCap("alice", "MAX_OPENINGS", null),
      business: {
        ...referenceInput().business,
        sectors: (referenceInput().business?.sectors ?? []).map((entry) => ({ ...entry, ...sector })),
      },
      employeeConstraints: withIndividualCap("alice", "MAX_OPENINGS", null).employeeConstraints,
    })
    expect(employeeOf(banned, "alice").maximumOpenings).toBe(0)
    expect(employeeOf(silent, "alice").maximumOpenings).toBe(3)
    expect(employeeOf(banned, "alice").maximumOpenings).not.toBe(
      employeeOf(silent, "alice").maximumOpenings
    )
  })

  it("interdit TOTALEMENT d'ouvrir quand le plafond individuel est zéro, malgré un secteur permissif", () => {
    const withCap = withIndividualCap("alice", "MAX_OPENINGS", 0)
    const problem = buildOk({
      ...withCap,
      business: {
        ...withCap.business,
        sectors: (withCap.business?.sectors ?? []).map((sector) => ({
          ...sector,
          maximumOpeningsPerWeek: 6,
        })),
      },
    })
    // Alice ouvre dans le planning de référence : le validateur doit le refuser.
    expect(brokenRules(problem, baselineFor(problem))).toContain("maximum-openings")
  })

  it("interdit TOTALEMENT de fermer quand le plafond individuel est zéro, malgré un secteur permissif", () => {
    const withCap = withIndividualCap("alice", "MAX_CLOSINGS", 0)
    const problem = buildOk({
      ...withCap,
      business: {
        ...withCap.business,
        sectors: (withCap.business?.sectors ?? []).map((sector) => ({
          ...sector,
          maximumClosingsPerWeek: 6,
        })),
      },
    })
    expect(brokenRules(problem, baselineFor(problem))).toContain("maximum-closings")
  })
})

describe("héritage des plafonds — le zéro traverse toute la chaîne", () => {
  /**
   * Depuis la fiche employé, pas depuis un `Constraint` fabriqué à la main.
   * Un zéro perdu à n'importe quel relais — traduction, formulaire, secteur —
   * rend une interdiction totale invisible, et c'est précisément le relais que
   * ce test refuse de laisser au hasard.
   */
  it("traduit un plafond individuel de zéro en contrainte, jamais en silence", () => {
    const constraints = mapEmployeeConstraints(
      employeeRecord("e1", { maxOpenings: 0, maxClosings: 0 })
    )
    expect(constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "MAX_OPENINGS", value: 0 }),
        expect.objectContaining({ type: "MAX_CLOSINGS", value: 0 }),
      ])
    )
  })

  it("n'émet rien quand le salarié n'a déclaré aucun plafond", () => {
    const constraints = mapEmployeeConstraints(
      employeeRecord("e1", { maxOpenings: null, maxClosings: null })
    )
    expect(constraints.some((constraint) => constraint.type === "MAX_OPENINGS")).toBe(false)
    expect(constraints.some((constraint) => constraint.type === "MAX_CLOSINGS")).toBe(false)
  })

  it("conserve le zéro de la fiche jusqu'au problème canonique, secteur permissif compris", () => {
    const sector = smallSector()
    const prepared = preparePlanningGeneration({
      // Aucune semaine publiée : ces tests ne portent pas sur l'équité.
      savedPlannings: [],
      store: storeConfig(),
      employees: smallSectorEmployees().map((person) =>
        person.id === "e1" ? { ...person, maxOpenings: 0 } : person
      ),
      sectors: [
        {
          ...sector,
          shiftRules: {
            ...sector.shiftRules,
            maximumOpeningsPerWeek: 4,
            maximumClosingsPerWeek: 4,
          },
        },
      ],
      scope: SMALL_SECTOR_SCOPE,
    })
    if (prepared.status === "error") {
      throw new Error(`Préparation impossible : ${prepared.errors.map((error) => error.message).join(" | ")}`)
    }

    const problem = buildOk(prepared.generationInput)
    // e1 a dit zéro : il garde zéro. e2 n'a rien dit : il hérite du secteur.
    expect(employeeOf(problem, "e1").maximumOpenings).toBe(0)
    expect(employeeOf(problem, "e2").maximumOpenings).toBe(4)
    // Et le plafond de fermetures, que personne n'a fixé, vient du secteur pour les deux.
    expect(employeeOf(problem, "e1").maximumClosings).toBe(4)
    expect(employeeOf(problem, "e2").maximumClosings).toBe(4)
  })

  it("laisse tout le monde sans plafond quand le secteur n'en déclare aucun", () => {
    const prepared = preparePlanningGeneration({
      // Aucune semaine publiée : ces tests ne portent pas sur l'équité.
      savedPlannings: [],
      store: storeConfig(),
      employees: smallSectorEmployees(),
      sectors: [smallSector()],
      scope: SMALL_SECTOR_SCOPE,
    })
    if (prepared.status === "error") throw new Error("Préparation impossible")
    const problem = buildOk(prepared.generationInput)
    expect(employeeOf(problem, "e1").maximumOpenings).toBeNull()
    expect(employeeOf(problem, "e1").maximumClosings).toBeNull()
  })
})

describe("validateur — les contraintes avancées mordent", () => {
  it("refuse un shift qui commence avant la borne de début", () => {
    // Alice ouvre à 06:00 dans le planning de référence.
    const problem = buildOk(withConstraints(bound("alice", "EARLIEST_START", 600)))
    expect(brokenRules(problem, baselineFor(problem))).toContain("availability")
  })

  it("refuse un shift qui finit après la borne de fin", () => {
    // Alice ferme à 20:00 le samedi dans le planning de référence.
    const problem = buildOk(withConstraints(bound("alice", "LATEST_END", 1_140)))
    expect(brokenRules(problem, baselineFor(problem))).toContain("availability")
  })

  it("accepte le même planning quand les bornes le laissent passer", () => {
    const problem = buildOk(
      withConstraints(
        bound("alice", "EARLIEST_START", 360),
        bound("alice", "LATEST_END", 1_200)
      )
    )
    expect(brokenRules(problem, baselineFor(problem))).toEqual([])
  })

  it("refuse une ouverture assurée par un salarié qui ne peut pas ouvrir", () => {
    const problem = buildOk(withCapabilities("alice", (keys) => keys.filter((key) => key !== "CAN_OPEN")))
    expect(brokenRules(problem, baselineFor(problem))).toContain("opening-capability")
  })

  it("refuse une fermeture assurée par un salarié qui ne peut pas fermer", () => {
    const problem = buildOk(withCapabilities("alice", (keys) => keys.filter((key) => key !== "CAN_CLOSE")))
    expect(brokenRules(problem, baselineFor(problem))).toContain("closing-capability")
  })

  it("refuse un dépassement du plafond individuel d'ouvertures", () => {
    const problem = buildOk(
      inputWith((input) => ({
        ...input,
        employeeConstraints: (input.employeeConstraints ?? []).map((constraint) =>
          String(constraint.employeeId) === "alice" && constraint.type === "MAX_OPENINGS"
            ? { ...constraint, value: 0 }
            : constraint
        ),
      }))
    )
    expect(employeeOf(problem, "alice").maximumOpenings).toBe(0)
    expect(brokenRules(problem, baselineFor(problem))).toContain("maximum-openings")
  })

  it("refuse un dépassement du plafond individuel de fermetures", () => {
    const problem = buildOk(
      inputWith((input) => ({
        ...input,
        employeeConstraints: (input.employeeConstraints ?? []).map((constraint) =>
          String(constraint.employeeId) === "dylan" && constraint.type === "MAX_CLOSINGS"
            ? { ...constraint, value: 0 }
            : constraint
        ),
      }))
    )
    expect(brokenRules(problem, baselineFor(problem))).toContain("maximum-closings")
  })

  it("refuse une coupure lorsque le salarié n'y a pas droit", () => {
    const problem = buildOk(withSector({ splitShiftAllowed: true, maximumSplitDuration: 90 }))
    expect(employeeOf(problem, "alice").canSplitShift).toBe(false)
    expect(brokenRules(problem, splitMonday(problem))).toContain("split-shift")
  })

  it("accepte la même coupure lorsque le salarié y a droit", () => {
    const input = withSector({ splitShiftAllowed: true, maximumSplitDuration: 90 })
    const problem = buildOk({
      ...input,
      employees: input.employees.map((employee) =>
        String(employee.id) === "alice"
          ? { ...employee, capabilities: [...employee.capabilities, "CAN_SPLIT_SHIFT"] as typeof employee.capabilities }
          : employee
      ),
    })
    expect(employeeOf(problem, "alice").canSplitShift).toBe(true)
    // Le même découpage, cette fois autorisé. Le planning peut rester
    // imparfait par ailleurs — déplacer un shift creuse un trou de couverture —
    // mais la coupure elle-même n'est plus un défaut.
    expect(brokenRules(problem, splitMonday(problem))).not.toContain("split-shift")
  })
})

describe("data bridge — traduction des bornes horaires", () => {
  it("n'émet aucune contrainte quand aucune borne n'est déclarée", () => {
    const constraints = mapEmployeeConstraints(employeeRecord("e1"))
    expect(constraints.some((constraint) => constraint.type === "EARLIEST_START")).toBe(false)
    expect(constraints.some((constraint) => constraint.type === "LATEST_END")).toBe(false)
  })

  it("traduit les bornes déclarées en minutes depuis minuit", () => {
    const constraints = mapEmployeeConstraints(
      employeeRecord("e1", { earliestStartTime: "08:15", latestEndTime: "18:00" })
    )
    expect(constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "EARLIEST_START", value: 495 }),
        expect.objectContaining({ type: "LATEST_END", value: 1_080 }),
      ])
    )
  })

  it("ignore une borne corrompue plutôt que de rétrécir une journée au hasard", () => {
    const constraints = mapEmployeeConstraints(
      employeeRecord("e1", { earliestStartTime: "n'importe quoi" })
    )
    expect(constraints.some((constraint) => constraint.type === "EARLIEST_START")).toBe(false)
  })
})

describe("ShiftOS ne connaît pas de jour facultatif", () => {
  it("rend obligatoire tout jour ouvert qui n'est ni repos fixe ni indisponibilité", () => {
    const problem = buildOk(referenceInput())
    for (const entry of problem.employeeDays) {
      // Trois états, et seulement trois : obligatoire, repos fixe, indisponible.
      // Aucun quatrième état ne laisse le moteur choisir de ne pas planifier.
      expect(entry.mandatory || entry.fixedRest || !entry.available).toBe(true)
      if (entry.available) expect(entry.mandatory).toBe(true)
    }
  })

  it("ne rend pas une journée facultative parce qu'une contrainte avancée la rétrécit", () => {
    const problem = buildOk(withConstraints(bound("alice", "EARLIEST_START", 900)))
    for (const entry of entriesOf(problem, "alice")) {
      expect(entry.available).toBe(true)
      expect(entry.mandatory).toBe(true)
    }
  })
})

/**
 * Les règles FIXES : « commence à », « finit à », « ouvre le », « ferme le ».
 *
 * Elles se distinguent des bornes sur un point qui change tout : une borne dit
 * ce qui est interdit, une règle fixe dit ce qui doit être. Un moteur qui les
 * confondrait produirait un planning que rien ne signale, parce qu'aucune borne
 * ne serait franchie — d'où un test par règle, côté problème ET côté verdict.
 */

function fixed(
  employeeId: string,
  type: "EXACT_START" | "EXACT_END",
  minutes: number
): Constraint {
  return {
    id: brand<ConstraintId>(`${type}_${employeeId}`),
    employeeId: brand<EmployeeId>(employeeId),
    type,
    value: minutes,
  }
}

/** Les dates que le verdict reproche, pour un message donné. */
function datesFlagged(
  problem: PlanningProblemV3,
  solution: PlanningSolutionV3,
  needle: string
): string[] {
  return validatePlanningSolutionV3(problem, solution)
    .violations.filter((violation) => violation.message.includes(needle))
    .map((violation) => String(violation.date))
    .sort()
}

function duty(
  employeeId: string,
  type: "MUST_OPEN" | "MUST_CLOSE",
  day: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday"
): Constraint {
  return {
    id: brand<ConstraintId>(`${type}_${employeeId}_${day}`),
    employeeId: brand<EmployeeId>(employeeId),
    type,
    day,
  }
}

describe("problème canonique — règles fixes individuelles", () => {
  it("porte l'heure de début imposée sur chaque jour ouvert", () => {
    const problem = buildOk(withConstraints(fixed("alice", "EXACT_START", 540)))
    for (const entry of entriesOf(problem, "alice")) {
      expect(entry.fixedStartMinutes).toBe(540)
    }
    for (const entry of entriesOf(problem, "bruno")) {
      expect(entry.fixedStartMinutes).toBeUndefined()
    }
  })

  it("rétrécit la fenêtre comme le ferait la borne souple", () => {
    // Sans cela le moteur générerait des journées commençant à 06:00 pour les
    // rejeter ensuite : la règle fixe doit se voir dès la génération.
    const problem = buildOk(withConstraints(fixed("alice", "EXACT_START", 540)))
    for (const entry of entriesOf(problem, "alice")) {
      expect(entry.earliestStartMinutes).toBe(540)
    }
  })

  it("porte l'heure de fin imposée sur chaque jour ouvert", () => {
    const problem = buildOk(withConstraints(fixed("alice", "EXACT_END", 1_080)))
    for (const entry of entriesOf(problem, "alice")) {
      expect(entry.fixedEndMinutes).toBe(1_080)
      expect(entry.latestEndMinutes).toBe(1_080)
    }
  })

  it("ne pose le devoir d'ouvrir que le jour nommé", () => {
    const problem = buildOk(withConstraints(duty("alice", "MUST_OPEN", "tuesday")))
    const marked = entriesOf(problem, "alice").filter((entry) => entry.mustOpen === true)
    expect(marked).toHaveLength(1)
    expect(problem.days.find((day) => day.date === marked[0].date)?.weekDay).toBe("tuesday")
  })

  it("ne pose le devoir de fermer que le jour nommé", () => {
    const problem = buildOk(withConstraints(duty("chloe", "MUST_CLOSE", "friday")))
    const marked = entriesOf(problem, "chloe").filter((entry) => entry.mustClose === true)
    expect(marked).toHaveLength(1)
    expect(problem.days.find((day) => day.date === marked[0].date)?.weekDay).toBe("friday")
  })

  it("entre dans l'empreinte du problème", () => {
    // Deux semaines qui ne diffèrent que par une règle fixe ne sont pas la même
    // semaine : une empreinte aveugle laisserait resservir la mauvaise solution.
    const plain = fingerprintProblem(buildOk(referenceInput()))
    const ruled = fingerprintProblem(buildOk(withConstraints(fixed("alice", "EXACT_START", 540))))
    expect(ruled).not.toBe(plain)
  })
})

describe("verdict — règles fixes individuelles", () => {
  it("refuse tout début qui n'est pas l'heure imposée, plus tard comme plus tôt", () => {
    // Alice ouvre à 06:00 les lundi, mardi et jeudi ; les trois autres jours
    // elle prend le milieu ou la fermeture. Lui imposer 06:00 doit condamner
    // EXACTEMENT ces trois jours-là — ils ne franchissent aucune borne, et
    // c'est toute la différence entre une borne et une heure imposée.
    const problem = buildOk(withConstraints(fixed("alice", "EXACT_START", 360)))
    expect(datesFlagged(problem, baselineFor(problem), "commence toujours à")).toEqual([
      REFERENCE_DATES[2],
      REFERENCE_DATES[4],
      REFERENCE_DATES[5],
    ])
  })

  it("refuse toute fin qui n'est pas l'heure imposée", () => {
    // Elle finit à 10:30 les trois jours où elle ouvre une journée courte.
    const problem = buildOk(withConstraints(fixed("alice", "EXACT_END", 630)))
    expect(datesFlagged(problem, baselineFor(problem), "finit toujours à")).toEqual([
      REFERENCE_DATES[2],
      REFERENCE_DATES[4],
      REFERENCE_DATES[5],
    ])
  })

  it("refuse un jour d'ouverture imposé que le planning ne donne pas", () => {
    // Alice ouvre bien le lundi ; Bruno, lui, prend le milieu de journée.
    const held = buildOk(withConstraints(duty("alice", "MUST_OPEN", "monday")))
    expect(brokenRules(held, baselineFor(held))).not.toContain("availability")

    const broken = buildOk(withConstraints(duty("bruno", "MUST_OPEN", "monday")))
    expect(brokenRules(broken, baselineFor(broken))).toContain("availability")
  })

  it("refuse un jour de fermeture imposé que le planning ne donne pas", () => {
    const held = buildOk(withConstraints(duty("dylan", "MUST_CLOSE", "monday")))
    expect(brokenRules(held, baselineFor(held))).not.toContain("availability")

    const broken = buildOk(withConstraints(duty("chloe", "MUST_CLOSE", "monday")))
    expect(brokenRules(broken, baselineFor(broken))).toContain("availability")
  })
})

describe("data bridge — traduction des règles fixes", () => {
  it("émet une borne souple tant que l'heure n'est pas déclarée exacte", () => {
    const constraints = mapEmployeeConstraints(
      employeeRecord("e1", { earliestStartTime: "09:00" })
    )
    expect(constraints.some((constraint) => constraint.type === "EARLIEST_START")).toBe(true)
    expect(constraints.some((constraint) => constraint.type === "EXACT_START")).toBe(false)
  })

  it("émet une heure imposée à la place de la borne quand elle est exacte", () => {
    const constraints = mapEmployeeConstraints(
      employeeRecord("e1", {
        earliestStartTime: "09:00",
        startTimeIsExact: true,
        latestEndTime: "18:00",
        endTimeIsExact: true,
      })
    )
    expect(constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "EXACT_START", value: 540 }),
        expect.objectContaining({ type: "EXACT_END", value: 1_080 }),
      ])
    )
    // La borne souple ne doit PAS coexister : deux règles pour un seul horaire
    // laisseraient croire qu'en supprimer une suffit à libérer la journée.
    expect(constraints.some((constraint) => constraint.type === "EARLIEST_START")).toBe(false)
    expect(constraints.some((constraint) => constraint.type === "LATEST_END")).toBe(false)
  })

  it("émet un devoir par jour nommé", () => {
    const constraints = mapEmployeeConstraints(
      employeeRecord("e1", { openingDays: ["monday", "thursday"], closingDays: ["saturday"] })
    )
    expect(
      constraints.filter((constraint) => constraint.type === "MUST_OPEN").map((constraint) => constraint.day)
    ).toEqual(["monday", "thursday"])
    expect(
      constraints.filter((constraint) => constraint.type === "MUST_CLOSE").map((constraint) => constraint.day)
    ).toEqual(["saturday"])
  })

  it("n'émet rien quand aucune règle fixe n'est déclarée", () => {
    const constraints = mapEmployeeConstraints(employeeRecord("e1"))
    for (const type of ["EXACT_START", "EXACT_END", "MUST_OPEN", "MUST_CLOSE"]) {
      expect(constraints.some((constraint) => constraint.type === type)).toBe(false)
    }
  })
})
