import { describe, expect, it } from "vitest"

import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { employeeSchema } from "@/features/employees/schemas/employee.schema"
import {
  arrangementLabel,
  arrangementOn,
  employeeDuring,
  employeesDuring,
} from "@/features/employees/models/contract-arrangement"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  createEmptyEmployeeFormValues,
  employeeToFormValues,
} from "@/features/employees/utils/employee.mappers"
import {
  SMALL_SECTOR_SCOPE,
  smallSector,
  smallSectorEmployees,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"

function employee(patch: Partial<EmployeeRecord> = {}): EmployeeRecord {
  return {
    id: "1",
    firstName: "Nadia",
    lastName: "Bloch",
    weeklyHours: 35,
    weeklyMinutes: 2_100,
    fixedDaysOff: ["sunday"],
    forbiddenDays: [],
    ...patch,
  } as unknown as EmployeeRecord
}

const arrangement = {
  reason: "therapeutic_part_time",
  start: "2026-03-01",
  end: "2026-05-31",
  weeklyMinutes: 1_050,
  daysOff: ["monday", "wednesday", "friday"],
} as const

function formValues(overrides: Record<string, unknown> = {}) {
  return {
    ...createEmptyEmployeeFormValues(),
    firstName: "Nadia",
    lastName: "Bloch",
    weeklyHours: "35",
    ...overrides,
  }
}

const activeArrangement = {
  arrangementActive: true,
  arrangementReason: "therapeutic_part_time",
  arrangementStart: "2026-03-01",
  arrangementEnd: "2026-05-31",
  arrangementHours: "17",
  arrangementMinuteRemainder: "30",
  arrangementDaysOff: ["monday", "wednesday", "friday"],
}

describe("le salarié pendant son aménagement", () => {
  const person = employee({ arrangement })

  it("garde son contrat entier avant le début", () => {
    const before = employeeDuring(person, "2026-02-28")
    expect(before.weeklyMinutes).toBe(2_100)
    expect(before.fixedDaysOff).toEqual(["sunday"])
  })

  it("porte le contrat réduit et les jours en moins pendant la période", () => {
    const during = employeeDuring(person, "2026-03-02")
    expect(during.weeklyMinutes).toBe(1_050)
    expect(during.weeklyHours).toBe(17.5)
    // Ajoutés à ses repos, jamais substitués : le dimanche reste un repos.
    expect([...during.fixedDaysOff].sort()).toEqual([
      "friday",
      "monday",
      "sunday",
      "wednesday",
    ])
  })

  it("retrouve son contrat entier après la fin", () => {
    expect(employeeDuring(person, "2026-06-01").weeklyMinutes).toBe(2_100)
  })

  it("suit la date repoussée quand la prescription est renouvelée", () => {
    // Le renouvellement se saisit en revenant repousser la fin, plutôt qu'en
    // laissant une fin ouverte que rien n'aurait jamais refermée.
    const renewed = employee({ arrangement: { ...arrangement, end: "2026-06-30" } })
    expect(employeeDuring(renewed, "2026-06-15").weeklyMinutes).toBe(1_050)
    expect(employeeDuring(renewed, "2026-07-01").weeklyMinutes).toBe(2_100)
    expect(arrangementOn(renewed, "2026-02-28")).toBeNull()
  })

  it("rend l'enregistrement INCHANGÉ quand rien n'est en vigueur", () => {
    // C'est la garantie de non-régression : sans aménagement, le planning
    // reçoit exactement les mêmes objets qu'avant l'existence de la notion.
    const ordinary = employee()
    expect(employeeDuring(ordinary, "2026-03-02")).toBe(ordinary)
    const team = [ordinary]
    expect(employeesDuring(team, "2026-03-02")[0]).toBe(ordinary)
  })

  it("se résume en une ligne lisible", () => {
    expect(arrangementLabel(arrangement)).toBe(
      "Mi-temps thérapeutique, 17 h 30, jusqu’au 31/05/2026"
    )
    expect(arrangementLabel({ ...arrangement, weeklyMinutes: 1_200 })).toBe(
      "Mi-temps thérapeutique, 20 h, jusqu’au 31/05/2026"
    )
  })
})

describe("la saisie de l'aménagement", () => {
  it("rassemble les champs plats en un aménagement", () => {
    const draft = employeeSchema.parse(formValues(activeArrangement))
    expect(draft.arrangement).toEqual({
      reason: "therapeutic_part_time",
      start: "2026-03-01",
      end: "2026-05-31",
      weeklyMinutes: 1_050,
      daysOff: ["monday", "wednesday", "friday"],
    })
  })

  it("efface l'aménagement quand la case est décochée", () => {
    // `null` et non l'absence : sinon un contrat réduit survivrait à sa fin.
    const draft = employeeSchema.parse(
      formValues({ ...activeArrangement, arrangementActive: false })
    )
    expect(draft.arrangement).toBeNull()
  })

  it("réclame toujours une date de fin", () => {
    const result = employeeSchema.safeParse(
      formValues({ ...activeArrangement, arrangementEnd: "" })
    )
    expect(result.error?.issues.some((issue) => issue.path[0] === "arrangementEnd")).toBe(true)
  })

  it("refuse un aménagement sans début, ou fini avant d'avoir commencé", () => {
    const noStart = employeeSchema.safeParse(
      formValues({ ...activeArrangement, arrangementStart: "" })
    )
    expect(noStart.success).toBe(false)
    const backwards = employeeSchema.safeParse(
      formValues({ ...activeArrangement, arrangementEnd: "2026-02-01" })
    )
    expect(backwards.error?.issues.some((issue) => issue.path[0] === "arrangementEnd")).toBe(true)
  })

  it("refuse un aménagement qui dépasse le contrat", () => {
    // Ce ne serait plus un aménagement, et le dépassement passerait ensuite
    // pour une consigne du médecin.
    const result = employeeSchema.safeParse(
      formValues({ ...activeArrangement, arrangementHours: "40" })
    )
    expect(result.error?.issues.some((issue) => issue.path[0] === "arrangementHours")).toBe(true)
    expect(
      employeeSchema.safeParse(formValues({ ...activeArrangement, arrangementHours: "35", arrangementMinuteRemainder: "0" })).success
    ).toBe(true)
  })

  it("ne contrôle rien tant que la case n'est pas cochée", () => {
    expect(employeeSchema.safeParse(formValues()).success).toBe(true)
  })
})

describe("la relecture d'une fiche", () => {
  it("relit une fiche antérieure comme « aucun aménagement »", () => {
    const legacy = { fixedDaysOff: [], forbiddenDays: [] } as unknown as EmployeeRecord
    const values = employeeToFormValues(legacy)
    expect(values.arrangementActive).toBe(false)
    expect(values.arrangementHours).toBe("")
  })

  it("relit un aménagement terminé sans l'effacer", () => {
    const values = employeeToFormValues(employee({ arrangement }))
    expect(values.arrangementActive).toBe(true)
    expect(values.arrangementHours).toBe("17")
    expect(values.arrangementMinuteRemainder).toBe("30")
    expect(values.arrangementDaysOff).toEqual(["monday", "wednesday", "friday"])
  })
})

describe("l'aménagement dans le planning", () => {
  /** La semaine de la fixture : lundi 6 juillet 2026. */
  const WEEK = "2026-07-06"

  function contractsFor(employees: readonly EmployeeRecord[]) {
    const prepared = preparePlanningGeneration({
      // Aucune semaine publiée : ces tests ne portent pas sur l'équité.
      savedPlannings: [],
      store: storeConfig(),
      employees,
      sectors: [smallSector()],
      scope: SMALL_SECTOR_SCOPE,
    })
    if (prepared.status === "error") {
      throw new Error(prepared.errors.map((error) => error.message).join(" | "))
    }
    const built = buildPlanningProblemV3(prepared.generationInput)
    if (!built.ok) {
      throw new Error(`Problème V3 invalide : ${built.errors.map((error) => error.message).join(" | ")}`)
    }
    return built.problem.employees
  }

  it("réduit le contrat que le solveur doit placer", () => {
    const reduced = contractsFor(
      smallSectorEmployees().map((person) =>
        person.id === "e1"
          ? {
              ...person,
              arrangement: {
                reason: "therapeutic_part_time",
                start: WEEK,
                end: "2026-09-30",
                weeklyMinutes: 600,
                daysOff: [],
              },
            }
          : person
      )
    )
    const e1 = reduced.find((entry) => String(entry.id) === "e1")
    const e2 = reduced.find((entry) => String(entry.id) === "e2")
    expect(e1?.contractMinutes).toBe(600)
    // Et personne d'autre n'a bougé.
    expect(e2?.contractMinutes).toBe(1_200)
  })

  it("ne change rien pour une semaine hors de la période", () => {
    const untouched = contractsFor(
      smallSectorEmployees().map((person) =>
        person.id === "e1"
          ? {
              ...person,
              arrangement: {
                reason: "therapeutic_part_time",
                start: "2026-01-01",
                end: "2026-01-31",
                weeklyMinutes: 600,
                daysOff: [],
              },
            }
          : person
      )
    )
    expect(untouched.find((entry) => String(entry.id) === "e1")?.contractMinutes).toBe(1_200)
  })
})
