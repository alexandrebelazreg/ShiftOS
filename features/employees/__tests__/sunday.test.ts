import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { employeeSchema } from "@/features/employees/schemas/employee.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  createEmptyEmployeeFormValues,
  employeeToFormValues,
} from "@/features/employees/utils/employee.mappers"
import { storeOpensOn } from "@/features/store/lib/opening-days"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

const featuresRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (...segments: string[]) => readFileSync(join(featuresRoot, ...segments), "utf8")

/** A complete, valid form payload; each test overrides only what it is about. */
function formValues(overrides: Record<string, unknown> = {}) {
  return {
    ...createEmptyEmployeeFormValues(),
    firstName: "Nadia",
    lastName: "Bloch",
    weeklyHours: "35",
    ...overrides,
  }
}

/** Le même volontaire dans tous les tests, sauf ce que chacun change. */
const volunteer = {
  sundayWork: true,
  sundayCommitment: "volunteer",
  maxSundaysPerMonth: "2",
  sundayCompensation: "compensatory_rest",
}

/** Un magasin dont on ne règle que le jour qui nous intéresse. */
function storeOpen(day: string, open: boolean): StoreConfig {
  return {
    openingHours: [{ day, closed: !open, opensAt: "08:30", closesAt: "20:00" }],
  } as unknown as StoreConfig
}

describe("dimanche — le réglage par défaut", () => {
  it("n'engage à rien tant que la case n'est pas cochée", () => {
    const empty = createEmptyEmployeeFormValues()
    expect(empty.sundayWork).toBe(false)
    expect(empty.sundayCommitment).toBe("volunteer")
    expect(empty.maxSundaysPerMonth).toBe("1")
    // Aucune contrepartie par défaut : en donner une ferait passer un oubli
    // pour une décision.
    expect(empty.sundayCompensation).toBe("")
  })

  it("relit une fiche antérieure à l'onglet comme « ne travaille pas le dimanche »", () => {
    const legacy = { fixedDaysOff: [], forbiddenDays: [], sectors: [] } as unknown as EmployeeRecord
    const values = employeeToFormValues(legacy)
    expect(values.sundayWork).toBe(false)
    expect(values.sundayCompensation).toBe("")
  })

  it("ramène un plafond venu d'ailleurs à l'un des quatre choix", () => {
    const record = (maxSundaysPerMonth: number | null) =>
      ({ fixedDaysOff: [], forbiddenDays: [], maxSundaysPerMonth }) as unknown as EmployeeRecord
    expect(employeeToFormValues(record(9)).maxSundaysPerMonth).toBe("4")
    expect(employeeToFormValues(record(0)).maxSundaysPerMonth).toBe("1")
    expect(employeeToFormValues(record(3)).maxSundaysPerMonth).toBe("3")
    // « Aucun plafond » repasse au plus prudent des quatre, jamais au plus large.
    expect(employeeToFormValues(record(null)).maxSundaysPerMonth).toBe("1")
  })
})

describe("dimanche — le plafond du volontaire", () => {
  it("garde le maximum qu'il a accepté", () => {
    const draft = employeeSchema.parse(formValues(volunteer))
    expect(draft.sundayCommitment).toBe("volunteer")
    expect(draft.maxSundaysPerMonth).toBe(2)
  })

  it("ne plafonne pas celui qui fait tous les dimanches", () => {
    // `null` = aucun plafond. Un 4 aurait menti les mois de cinq dimanches.
    const draft = employeeSchema.parse(
      formValues({ ...volunteer, sundayCommitment: "fixed", maxSundaysPerMonth: "4" })
    )
    expect(draft.sundayCommitment).toBe("fixed")
    expect(draft.maxSundaysPerMonth).toBeNull()
  })

  it("reste un plafond même quand le dimanche est un repos fixe", () => {
    // L'usage de la maison : le dimanche reste en repos, et le volontaire est
    // appelé quand même — dans sa limite. Rien ici ne doit refuser la fiche.
    const result = employeeSchema.safeParse(
      formValues({ ...volunteer, fixedDaysOff: ["sunday"] })
    )
    expect(result.success).toBe(true)
    expect(result.data?.maxSundaysPerMonth).toBe(2)
    expect(result.data?.fixedDaysOff).toEqual(["sunday"])
  })
})

describe("dimanche — la contrepartie", () => {
  it("est obligatoire dès qu'il travaille le dimanche", () => {
    const result = employeeSchema.safeParse(
      formValues({ ...volunteer, sundayCompensation: "" })
    )
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.path[0] === "sundayCompensation")).toBe(true)
  })

  it("accepte chacune des trois, et rien d'autre", () => {
    for (const sundayCompensation of ["smoothed", "compensatory_rest", "overtime"]) {
      const draft = employeeSchema.parse(formValues({ ...volunteer, sundayCompensation }))
      expect(draft.sundayCompensation).toBe(sundayCompensation)
    }
    expect(
      employeeSchema.safeParse(formValues({ ...volunteer, sundayCompensation: "rien" })).success
    ).toBe(false)
  })

  it("n'est pas exigée de qui ne travaille pas le dimanche", () => {
    const result = employeeSchema.safeParse(formValues({ sundayWork: false }))
    expect(result.success).toBe(true)
    expect(result.data?.sundayCompensation).toBeNull()
  })

  it("efface tout ce qui dépend d'un accord retiré", () => {
    const draft = employeeSchema.parse(formValues({ ...volunteer, sundayWork: false }))
    expect(draft.sundayCommitment).toBe("volunteer")
    expect(draft.maxSundaysPerMonth).toBeNull()
    expect(draft.sundayCompensation).toBeNull()
  })
})

describe("dimanche — l'onglet", () => {
  it("est grisé lorsque le magasin ferme ce jour-là, jamais retiré", () => {
    // Retirer l'onglet laisserait croire que le réglage n'existe pas ; grisé, il
    // dit qu'il est hors sujet ici, et redeviendra saisissable sans rien perdre.
    const form = read("employees", "components", "EmployeeForm.tsx")
    expect(form).toContain('{ value: "dimanche", label: "Dimanche" }')
    expect(form).toContain("disabled={closed}")
  })

  it("redevient atteignable lorsqu'il porte l'erreur qui bloque l'enregistrement", () => {
    // Le magasin peut fermer le dimanche APRÈS qu'une fiche y a été réglée :
    // un onglet grisé sur une erreur serait un enregistrement impossible à
    // débloquer.
    const form = read("employees", "components", "EmployeeForm.tsx")
    expect(form).toMatch(
      /const closed = item\.value === "dimanche" && !sundayOpen && !sundayBlocks/
    )
    expect(form).toMatch(/sundayBlocks = Object\.keys\(errors\)\.some/)
    expect(form).toContain('FIELD_TABS[field] === "dimanche"')
  })

  it("cache le plafond de qui fait tous les dimanches", () => {
    const tab = read("employees", "components", "tabs", "DimancheTab.tsx")
    expect(tab).toMatch(/\{sundayCommitment === "volunteer" \?/)
    expect(tab).toMatch(/\{sundayWork \?/)
  })
})

describe("dimanche — les horaires du magasin", () => {
  it("lit la fermeture déclarée", () => {
    expect(storeOpensOn(storeOpen("sunday", true), "sunday")).toBe(true)
    expect(storeOpensOn(storeOpen("sunday", false), "sunday")).toBe(false)
  })

  it("suppose la semaine ouverte et le dimanche fermé sans magasin réglé", () => {
    expect(storeOpensOn(null, "sunday")).toBe(false)
    expect(storeOpensOn(null, "monday")).toBe(true)
  })
})
