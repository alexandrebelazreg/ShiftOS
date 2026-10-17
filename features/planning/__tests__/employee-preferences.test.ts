import { describe, expect, it } from "vitest"

import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { employeeSchema } from "@/features/employees/schemas/employee.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  createEmptyEmployeeFormValues,
  employeeToFormValues,
} from "@/features/employees/utils/employee.mappers"
import { preferencesSummary } from "@/features/employees/utils/preferences-summary"
import {
  SMALL_SECTOR_SCOPE,
  smallSector,
  smallSectorEmployees,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"

/**
 * Les souhaits de la fiche jusqu'au problème posé au moteur.
 *
 * « Préfère les ouvertures » était perdu en route : le constructeur écrivait
 * `prefersOpening: false` pour tout le monde. Les heures souhaitées, elles,
 * n'existaient pas.
 */
function problemFor(employees: readonly EmployeeRecord[]) {
  const prepared = preparePlanningGeneration({
    savedPlannings: [],
    absences: [],
    store: storeConfig(),
    employees,
    sectors: [smallSector()],
    scope: SMALL_SECTOR_SCOPE,
  })
  if (prepared.status === "error") throw new Error(prepared.errors.map((e) => e.message).join(" | "))
  const built = buildPlanningProblemV3(prepared.generationInput)
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join(" | "))
  return built.problem
}

function withWishes(patch: Partial<EmployeeRecord>): EmployeeRecord[] {
  return smallSectorEmployees().map((person) => (person.id === "e1" ? { ...person, ...patch } : person))
}

describe("les souhaits dans le problème", () => {
  it("transmet « préfère ouvrir » et les heures souhaitées", () => {
    const problem = problemFor(
      withWishes({
        preferOpening: true,
        preferredStartSide: "after",
        preferredStartTime: "10:00",
        preferredEndSide: "before",
        preferredEndTime: "16:30",
      })
    )
    const e1 = problem.employees.find((entry) => String(entry.id) === "e1")
    expect(e1?.prefersOpening).toBe(true)
    expect(e1?.preferredStart).toEqual({ side: "after", minutes: 600 })
    expect(e1?.preferredEnd).toEqual({ side: "before", minutes: 990 })
  })

  it("ne change rien à un problème sans souhait", () => {
    const problem = problemFor(smallSectorEmployees())
    for (const employee of problem.employees) {
      expect("preferredStart" in employee).toBe(false)
      expect("preferredEnd" in employee).toBe(false)
      expect(employee.prefersOpening).toBe(false)
    }
  })

  it("ignore une moitié de souhait plutôt que de la deviner", () => {
    const problem = problemFor(withWishes({ preferredStartSide: "after", preferredStartTime: null }))
    const e1 = problem.employees.find((entry) => String(entry.id) === "e1")
    expect(e1 && "preferredStart" in e1).toBe(false)
  })
})

describe("la fiche", () => {
  const base = () => ({ ...createEmptyEmployeeFormValues(), firstName: "Léa", lastName: "Test", weeklyHours: "35" })

  it("accepte une préférence complète, et l'enregistre en clair", () => {
    const parsed = employeeSchema.safeParse({ ...base(), preferredEndSide: "after", preferredEndTime: "17:00" })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.preferredEndSide).toBe("after")
      expect(parsed.data.preferredEndTime).toBe("17:00")
      expect(parsed.data.preferredStartSide).toBeNull()
    }
  })

  it("refuse un sens sans heure, et une heure sans sens", () => {
    const noTime = employeeSchema.safeParse({ ...base(), preferredStartSide: "before" })
    expect(noTime.success).toBe(false)
    const noSide = employeeSchema.safeParse({ ...base(), preferredStartTime: "09:00" })
    expect(noSide.success).toBe(false)
  })

  it("relit une fiche antérieure comme « aucune préférence »", () => {
    const values = employeeToFormValues(smallSectorEmployees()[0])
    expect(values.preferredStartSide).toBe("")
    expect(values.preferredEndTime).toBe("")
  })

  it("résume la section repliée", () => {
    expect(
      preferencesSummary({
        preferOpening: false,
        preferClosing: true,
        preferredStartSide: "after",
        preferredStartTime: "10:00",
        preferredEndSide: "",
        preferredEndTime: "",
      })
    ).toEqual(["Préfère fermer", "Préfère commencer après 10:00"])
  })
})
