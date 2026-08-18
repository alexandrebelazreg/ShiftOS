import { describe, expect, it } from "vitest"

import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import { employeeSchema } from "@/features/employees/schemas/employee.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { createEmptyEmployeeFormValues } from "@/features/employees/utils/employee.mappers"
import { absentOn, permanenceRoster } from "@/features/permanence/domain/permanence-roster"

function employee(patch: Partial<EmployeeRecord> & { id: string }): EmployeeRecord {
  return {
    firstName: "Sans",
    lastName: "Nom",
    phone: "",
    email: "",
    status: "active",
    weeklyHours: 35,
    workingDays: [],
    contractType: "full_time",
    canOpen: true,
    canClose: true,
    splitShiftAllowed: false,
    fixedDaysOff: [],
    forbiddenDays: [],
    maxOpenings: null,
    maxClosings: null,
    preferOpening: false,
    preferClosing: false,
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  }
}

describe("l’effectif du tour de permanence", () => {
  it("ne retient que les fiches où la permanence est cochée", () => {
    const roster = permanenceRoster([
      employee({ id: "1", firstName: "Alex", permanence: true }),
      employee({ id: "2", firstName: "Bruno" }),
      employee({ id: "3", firstName: "Chloé", permanence: false }),
    ])

    expect(roster.map((member) => member.shortName)).toEqual(["Alex"])
  })

  it("écarte les inactifs : ils ne sont plus là pour porter les clés", () => {
    const roster = permanenceRoster([
      employee({ id: "1", firstName: "Partie", permanence: true, status: "inactive" }),
      employee({ id: "2", firstName: "Restée", permanence: true }),
    ])

    expect(roster.map((member) => member.shortName)).toEqual(["Restée"])
  })

  it("reprend les jours imposés, préférés et les repos fixes de la fiche", () => {
    const [member] = permanenceRoster([
      employee({
        id: "1",
        firstName: "Alex",
        permanence: true,
        permanenceRequiredClosingDays: ["monday"],
        permanencePreferredOpeningDays: ["friday"],
        fixedDaysOff: ["wednesday"],
      }),
    ])

    expect(member).toMatchObject({
      requiredClosingDays: ["monday"],
      preferredOpeningDays: ["friday"],
      requiredOpeningDays: [],
      preferredClosingDays: [],
      daysOff: ["wednesday"],
    })
  })

  it("distingue deux homonymes par l’initiale, sinon la feuille devient illisible", () => {
    const roster = permanenceRoster([
      employee({ id: "1", firstName: "Marie", lastName: "Alba", permanence: true }),
      employee({ id: "2", firstName: "Marie", lastName: "Zerbi", permanence: true }),
      employee({ id: "3", firstName: "Alex", lastName: "Bral", permanence: true }),
    ])

    expect(roster.map((member) => member.shortName)).toEqual(["Alex", "Marie A.", "Marie Z."])
  })

  it("range l’effectif par ordre alphabétique — un ordre stable est un ordre juste", () => {
    const roster = permanenceRoster([
      employee({ id: "1", firstName: "Zoé", permanence: true }),
      employee({ id: "2", firstName: "Émile", permanence: true }),
      employee({ id: "3", firstName: "Alex", permanence: true }),
    ])

    expect(roster.map((member) => member.shortName)).toEqual(["Alex", "Émile", "Zoé"])
  })

  it("relit une fiche antérieure au tour de permanence sans la refuser", () => {
    // Ni le drapeau ni les jours ne sont présents : l'absence vaut « n'y
    // participe pas », et la fiche n'a pas à être rouverte pour le dire.
    expect(permanenceRoster([employee({ id: "1", firstName: "Ancienne" })])).toEqual([])
  })
})

describe("les absences, côté permanence", () => {
  const absence = (
    employeeId: string,
    start: string,
    end: string,
    overrides: Partial<AbsenceRecord> = {}
  ): AbsenceRecord => ({
    id: `${employeeId}-${start}`,
    employeeId,
    type: "sick_leave",
    start,
    end,
    ...overrides,
  })

  const absences = [
    absence("1", "2026-01-05", "2026-01-09"),
    absence("2", "2026-01-08", "2026-01-08"),
  ]

  it("retient qui est absent un jour donné, bornes comprises", () => {
    expect([...absentOn(absences, "2026-01-05")]).toEqual(["1"])
    expect([...absentOn(absences, "2026-01-09")]).toEqual(["1"])
    expect([...absentOn(absences, "2026-01-08")].sort()).toEqual(["1", "2"])
  })

  it("ne retient personne hors des périodes saisies", () => {
    expect(absentOn(absences, "2026-01-04").size).toBe(0)
    expect(absentOn(absences, "2026-01-10").size).toBe(0)
  })

  it("suit la fin repoussée par une prolongation", () => {
    const extended = [absence("3", "2026-01-05", "2026-01-16")]
    expect([...absentOn(extended, "2026-01-16")]).toEqual(["3"])
    expect(absentOn(extended, "2026-01-17").size).toBe(0)
  })

  it("ne retient plus une absence annulée", () => {
    const cancelled = [absence("4", "2026-01-05", "2026-01-09", { status: "cancelled" })]
    expect(absentOn(cancelled, "2026-01-06").size).toBe(0)
  })
})

describe("la fiche employé, côté permanence", () => {
  const values = (overrides: Record<string, unknown> = {}) => ({
    ...createEmptyEmployeeFormValues(),
    firstName: "Nadia",
    lastName: "Bloch",
    weeklyHours: "35",
    ...overrides,
  })

  it("efface les jours de permanence de qui n’y participe plus", () => {
    // Un réglage devenu invisible à l'écran continuerait sinon d'imposer des
    // fermetures à quelqu'un que le tour ne concerne plus.
    const parsed = employeeSchema.parse(
      values({ permanence: false, permanenceRequiredClosingDays: ["monday"] })
    )

    expect(parsed.permanenceRequiredClosingDays).toEqual([])
  })

  it("garde les jours de permanence de qui y participe", () => {
    const parsed = employeeSchema.parse(
      values({
        permanence: true,
        permanenceRequiredClosingDays: ["monday"],
        permanencePreferredOpeningDays: ["saturday"],
      })
    )

    expect(parsed.permanenceRequiredClosingDays).toEqual(["monday"])
    expect(parsed.permanencePreferredOpeningDays).toEqual(["saturday"])
  })

  it("refuse d’imposer une permanence un jour de repos fixe", () => {
    const parsed = employeeSchema.safeParse(
      values({
        permanence: true,
        fixedDaysOff: ["sunday"],
        permanenceRequiredClosingDays: ["sunday"],
      })
    )

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path).toEqual(["permanenceRequiredClosingDays"])
  })

  it("accepte en revanche un jour seulement PRÉFÉRÉ qui tombe sur un repos", () => {
    // Il ne sera jamais retenu, ce qui est sans conséquence — refuser la fiche
    // ferait perdre un réglage inoffensif.
    const parsed = employeeSchema.safeParse(
      values({
        permanence: true,
        fixedDaysOff: ["sunday"],
        permanencePreferredClosingDays: ["sunday"],
      })
    )

    expect(parsed.success).toBe(true)
  })
})
