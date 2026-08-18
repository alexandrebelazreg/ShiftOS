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

  it("reprend la liste blanche, le plafond et le dernier recours", () => {
    const [member] = permanenceRoster([
      employee({
        id: "1",
        firstName: "Alex",
        permanence: true,
        permanenceClosingOnlyDays: ["monday", "friday"],
        permanenceMaxClosings: 4,
        permanenceLastResortClosing: true,
      }),
    ])

    expect(member).toMatchObject({
      closingOnlyDays: ["monday", "friday"],
      maxClosings: 4,
      lastResortOpening: false,
      lastResortClosing: true,
    })
  })

  it("lit l’absence de ces réglages comme « aucune restriction »", () => {
    const [member] = permanenceRoster([employee({ id: "1", firstName: "Alex", permanence: true })])

    expect(member).toMatchObject({
      closingOnlyDays: [],
      maxClosings: null,
      lastResortOpening: false,
      lastResortClosing: false,
    })
    // Ouvrir et fermer sont des tâches ordinaires : une fiche qui n'en dit rien
    // les accorde, sinon toute fiche antérieure sortirait du tour en silence.
    expect(member).toMatchObject({ canOpen: true, canClose: true })
  })

  it("reprend le droit d’ouvrir et de fermer le magasin", () => {
    const [member] = permanenceRoster([
      employee({
        id: "1",
        firstName: "Alex",
        permanence: true,
        permanenceCanOpen: true,
        permanenceCanClose: false,
      }),
    ])

    expect(member).toMatchObject({ canOpen: true, canClose: false })
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

  it("efface aussi le plafond et le dernier recours de qui n’y participe plus", () => {
    const parsed = employeeSchema.parse(
      values({
        permanence: false,
        permanenceClosingOnlyDays: ["monday"],
        permanenceMaxClosings: "3",
        permanenceLastResortOpening: true,
        permanenceLastResortClosing: true,
      })
    )

    expect(parsed.permanenceClosingOnlyDays).toEqual([])
    expect(parsed.permanenceMaxClosings).toBeNull()
    expect(parsed.permanenceLastResortOpening).toBe(false)
    expect(parsed.permanenceLastResortClosing).toBe(false)
  })

  it("lit un maximum de fermetures vide comme « aucun plafond »", () => {
    const parsed = employeeSchema.parse(values({ permanence: true, permanenceMaxClosings: "" }))

    expect(parsed.permanenceMaxClosings).toBeNull()
    // Zéro est un vrai plafond, pas une absence : celui de quelqu'un qui reste
    // dans le tour pour les ouvertures seules.
    expect(
      employeeSchema.parse(values({ permanence: true, permanenceMaxClosings: "0" }))
        .permanenceMaxClosings
    ).toBe(0)
  })

  it("efface les réglages de fermeture de qui ne sait pas fermer le magasin", () => {
    // Le droit retiré retire le devoir, comme `canOpen` et ses jours
    // d'ouverture : un réglage devenu invisible ne doit plus contraindre.
    const parsed = employeeSchema.parse(
      values({
        permanence: true,
        permanenceCanClose: false,
        permanenceRequiredClosingDays: ["monday"],
        permanenceClosingOnlyDays: ["monday"],
        permanenceMaxClosings: "2",
        permanenceLastResortClosing: true,
        permanenceLastResortOpening: true,
      })
    )

    expect(parsed.permanenceRequiredClosingDays).toEqual([])
    expect(parsed.permanenceClosingOnlyDays).toEqual([])
    expect(parsed.permanenceMaxClosings).toBeNull()
    expect(parsed.permanenceLastResortClosing).toBe(false)
    // Celui de l'ouverture survit : c'est le droit de FERMER qui a été retiré.
    expect(parsed.permanenceLastResortOpening).toBe(true)
  })

  it("garde intacts les réglages d’ouverture de la même fiche", () => {
    const parsed = employeeSchema.parse(
      values({
        permanence: true,
        permanenceCanClose: false,
        permanenceRequiredOpeningDays: ["friday"],
      })
    )

    expect(parsed.permanenceRequiredOpeningDays).toEqual(["friday"])
  })

  it("refuse quelqu’un du tour qui ne sait ni ouvrir ni fermer", () => {
    const parsed = employeeSchema.safeParse(
      values({ permanence: true, permanenceCanOpen: false, permanenceCanClose: false })
    )

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path).toEqual(["permanenceCanOpen"])
  })

  it("accepte les mêmes cases décochées hors du tour", () => {
    // Hors du tour, la question ne se pose pas : les deux droits reviennent à
    // leur valeur ordinaire plutôt que de bloquer un enregistrement.
    const parsed = employeeSchema.safeParse(
      values({ permanence: false, permanenceCanOpen: false, permanenceCanClose: false })
    )

    expect(parsed.success).toBe(true)
    expect(parsed.data?.permanenceCanOpen).toBe(true)
  })

  it("refuse un jour imposé que la liste blanche interdit", () => {
    const parsed = employeeSchema.safeParse(
      values({
        permanence: true,
        permanenceClosingOnlyDays: ["monday"],
        permanenceRequiredClosingDays: ["tuesday"],
      })
    )

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path).toEqual(["permanenceRequiredClosingDays"])
    expect(parsed.error?.issues[0].message).toContain("mardi")
  })

  it("accepte un jour imposé que la liste blanche autorise", () => {
    const parsed = employeeSchema.safeParse(
      values({
        permanence: true,
        permanenceClosingOnlyDays: ["monday", "friday"],
        permanenceRequiredClosingDays: ["monday"],
      })
    )

    expect(parsed.success).toBe(true)
  })

  it("refuse un plafond de zéro à qui a une liste blanche — elle impose aussi", () => {
    const parsed = employeeSchema.safeParse(
      values({
        permanence: true,
        permanenceMaxClosings: "0",
        permanenceClosingOnlyDays: ["monday"],
      })
    )

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path).toEqual(["permanenceMaxClosings"])
  })

  it("refuse un plafond de zéro à qui a des fermetures imposées", () => {
    const parsed = employeeSchema.safeParse(
      values({
        permanence: true,
        permanenceMaxClosings: "0",
        permanenceRequiredClosingDays: ["monday"],
      })
    )

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path).toEqual(["permanenceMaxClosings"])
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
