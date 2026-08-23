import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { employeeSchema } from "@/features/employees/schemas/employee.schema"
import { memoryStore } from "@/features/core/shared/key-value-store"
import { createEmployeeRepository } from "@/features/employees/persistence/employee.repository"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  ADVANCED_CONSTRAINTS_DEFAULTS,
  ADVANCED_CONSTRAINTS_OPEN_BY_DEFAULT,
  advancedConstraintsSummary,
  hasAdvancedConstraints,
} from "@/features/employees/utils/advanced-constraints"
import {
  createEmptyEmployeeFormValues,
  employeeToFormValues,
} from "@/features/employees/utils/employee.mappers"

const featuresRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const read = (...segments: string[]) => readFileSync(join(featuresRoot, ...segments), "utf8")
const readComponent = (name: string) =>
  readFileSync(join(featuresRoot, "..", "components", "ui", name), "utf8")

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

/**
 * Le stockage est DIT, au lieu d'être subi.
 *
 * Ces tests s'appuyaient sans le savoir sur un tableau de module : sans
 * `window`, l'ancien service n'écrivait nulle part et relisait sa propre
 * mémoire. Un stockage en mémoire explicite dit la même chose, mais le dit —
 * et il repart vide à chaque fichier au lieu de traîner d'un test à l'autre.
 */
const employeeService = createEmployeeRepository(memoryStore())

describe("contraintes avancées — la section", () => {
  it("est fermée par défaut", () => {
    expect(ADVANCED_CONSTRAINTS_OPEN_BY_DEFAULT).toBe(false)
  })

  it("est rendue par l'onglet Contraintes avec ce défaut, jamais ouverte en dur", () => {
    const tab = read("employees", "components", "tabs", "ContraintesTab.tsx")
    expect(tab).toContain("Contraintes avancées")
    expect(tab).toContain("defaultOpen={ADVANCED_CONSTRAINTS_OPEN_BY_DEFAULT}")
    expect(tab).not.toContain("defaultOpen={true}")
    expect(tab).not.toContain("defaultOpen\n")
  })

  /**
   * Un repli qui cache une erreur est pire qu'une erreur muette : le formulaire
   * refuse d'enregistrer, renvoie sur l'onglet Contraintes, et l'écran paraît
   * intact. La section doit donc s'ouvrir d'elle-même quand elle porte une
   * erreur — constaté replié en vérification manuelle, puis corrigé.
   */
  it("s'ouvre d'elle-même lorsqu'un de ses champs est en erreur", () => {
    const tab = read("employees", "components", "tabs", "ContraintesTab.tsx")
    expect(tab).toContain("revealWhen={hasAdvancedError}")
    expect(tab).toMatch(/hasAdvancedError\s*=\s*ADVANCED_FIELDS\.some/)

    const section = readComponent("collapsible-section.tsx")
    expect(section).toContain("revealWhen")
    // Impératif et à sens unique : on révèle, puis on cesse d'interférer.
    expect(section).toMatch(/if \(revealWhen && ref\.current\) ref\.current\.open = true/)
  })

  it("surveille et révèle exactement les mêmes champs", () => {
    // Une seule liste : un champ résumé mais jamais révélé serait invisible au
    // moment précis où il bloque l'enregistrement.
    const tab = read("employees", "components", "tabs", "ContraintesTab.tsx")
    const declared = tab
      .slice(tab.indexOf("const ADVANCED_FIELDS"), tab.indexOf("] as const"))
      .match(/"([a-zA-Z]+)"/g)
      ?.map((entry) => entry.replaceAll('"', ""))
    expect(new Set(declared)).toEqual(
      new Set([
        "canOpen",
        "canClose",
        "splitShiftAllowed",
        "maxOpenings",
        "maxClosings",
        "earliestStartTime",
        "latestEndTime",
        "startTimeIsExact",
        "endTimeIsExact",
        "openingDays",
        "closingDays",
      ])
    )
    // Et chacun est bien rendu à l'intérieur du repli.
    const advanced = tab.slice(tab.indexOf("<CollapsibleSection"))
    for (const field of declared ?? []) expect(advanced).toContain(field)
  })

  it("ne dit rien quand l'employé suit les règles de la maison", () => {
    const summary = advancedConstraintsSummary(formValues())
    expect(summary).toEqual([])
    expect(hasAdvancedConstraints(formValues())).toBe(false)
  })

  it("résume chaque contrainte active, et seulement celles-là", () => {
    const summary = advancedConstraintsSummary(
      formValues({
        earliestStartTime: "08:00",
        latestEndTime: "18:00",
        canOpen: false,
        canClose: false,
        splitShiftAllowed: true,
        maxOpenings: "1",
        maxClosings: "2",
      })
    )
    expect(summary).toEqual([
      "Ne commence pas avant 08:00",
      "Ne finit pas après 18:00",
      "Ne peut pas ouvrir",
      "Ne peut pas fermer",
      "1 ouverture/semaine max",
      "2 fermetures/semaine max",
      "Coupure autorisée",
    ])
  })

  it("compte un plafond de zéro comme une contrainte, pas comme une absence de plafond", () => {
    // « 0 ouverture » est une décision ; « champ vide » est l'absence de
    // décision. Les confondre ferait disparaître la plus stricte des deux.
    expect(advancedConstraintsSummary(formValues({ maxOpenings: "0" }))).toEqual([
      "0 ouverture/semaine max",
    ])
    expect(advancedConstraintsSummary(formValues({ maxOpenings: "" }))).toEqual([])
  })

  it("lit indifféremment un enregistrement persisté et des valeurs de formulaire", () => {
    const record = { canOpen: true, canClose: false, splitShiftAllowed: false, maxOpenings: null, maxClosings: 2, earliestStartTime: null, latestEndTime: "18:00" }
    expect(advancedConstraintsSummary(record)).toEqual([
      "Ne finit pas après 18:00",
      "Ne peut pas fermer",
      "2 fermetures/semaine max",
    ])
  })
})

describe("contraintes avancées — valeurs par défaut", () => {
  it("autorise l'ouverture et la fermeture, jamais la coupure", () => {
    const empty = createEmptyEmployeeFormValues()
    expect(empty.canOpen).toBe(true)
    expect(empty.canClose).toBe(true)
    expect(empty.splitShiftAllowed).toBe(false)
    expect(empty.earliestStartTime).toBe("")
    expect(empty.latestEndTime).toBe("")
  })
})

describe("contraintes avancées — validation", () => {
  it("accepte des bornes sur le pas horaire canonique", () => {
    const parsed = employeeSchema.parse(
      formValues({ earliestStartTime: "08:15", latestEndTime: "18:45" })
    )
    expect(parsed.earliestStartTime).toBe("08:15")
    expect(parsed.latestEndTime).toBe("18:45")
  })

  it("traite un champ vide comme l'absence de restriction", () => {
    const parsed = employeeSchema.parse(formValues({ earliestStartTime: "", latestEndTime: "" }))
    expect(parsed.earliestStartTime).toBeNull()
    expect(parsed.latestEndTime).toBeNull()
  })

  it("refuse une heure hors du pas horaire canonique", () => {
    const result = employeeSchema.safeParse(formValues({ earliestStartTime: "08:07" }))
    expect(result.success).toBe(false)
    expect(result.error?.issues.some((issue) => issue.path[0] === "earliestStartTime")).toBe(true)
  })

  it("refuse une fin antérieure ou égale au début", () => {
    for (const latestEndTime of ["08:00", "07:00"]) {
      const result = employeeSchema.safeParse(
        formValues({ earliestStartTime: "08:00", latestEndTime })
      )
      expect(result.success).toBe(false)
      expect(result.error?.issues.some((issue) => issue.path[0] === "latestEndTime")).toBe(true)
    }
  })

  it("n'oppose rien à une borne isolée", () => {
    // Une seule borne ne peut contredire une borne jamais énoncée.
    expect(employeeSchema.safeParse(formValues({ earliestStartTime: "18:00" })).success).toBe(true)
    expect(employeeSchema.safeParse(formValues({ latestEndTime: "08:00" })).success).toBe(true)
  })

  it("refuse un plafond négatif ou fractionnaire", () => {
    expect(employeeSchema.safeParse(formValues({ maxOpenings: "-1" })).success).toBe(false)
    expect(employeeSchema.safeParse(formValues({ maxClosings: "1.5" })).success).toBe(false)
    expect(employeeSchema.safeParse(formValues({ maxOpenings: "0" })).success).toBe(true)
  })
})

describe("contraintes avancées — chargement et sauvegarde", () => {
  it("enregistre puis relit les valeurs saisies", async () => {
    const draft = employeeSchema.parse(
      formValues({
        earliestStartTime: "08:00",
        latestEndTime: "18:00",
        canOpen: false,
        canClose: true,
        splitShiftAllowed: true,
        maxOpenings: "0",
        maxClosings: "2",
      })
    )
    const created = await employeeService.create(draft)

    expect(created).toEqual(
      expect.objectContaining({
        earliestStartTime: "08:00",
        latestEndTime: "18:00",
        canOpen: false,
        canClose: true,
        splitShiftAllowed: true,
        maxOpenings: 0,
        maxClosings: 2,
      })
    )

    // Le tour complet : ce qui est relu dans le formulaire est ce qui a été saisi.
    const values = employeeToFormValues(created)
    expect(values.earliestStartTime).toBe("08:00")
    expect(values.latestEndTime).toBe("18:00")
    expect(values.maxOpenings).toBe("0")
    expect(values.maxClosings).toBe("2")

    const cleared = await employeeService.update(created.id, {
      ...draft,
      earliestStartTime: null,
      latestEndTime: null,
    })
    expect(cleared.earliestStartTime).toBeNull()
    expect(employeeToFormValues(cleared).earliestStartTime).toBe("")
  })
})

describe("contraintes avancées — rétrocompatibilité", () => {
  /** An employee saved before the advanced constraints existed. */
  const legacy = {
    id: "legacy_1",
    firstName: "Ancien",
    lastName: "Salarié",
    phone: "",
    email: "",
    status: "active",
    weeklyHours: 35,
    workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
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
  } as EmployeeRecord

  it("ouvre sans erreur un employé dépourvu des nouveaux champs", () => {
    const values = employeeToFormValues(legacy)
    expect(values.earliestStartTime).toBe("")
    expect(values.latestEndTime).toBe("")
  })

  it("ne lui invente aucune contrainte avancée", () => {
    expect(hasAdvancedConstraints(legacy)).toBe(false)
  })

  it("le réenregistre sans exiger les nouveaux champs", () => {
    const parsed = employeeSchema.safeParse({
      ...formValues(),
      earliestStartTime: undefined,
      latestEndTime: undefined,
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.earliestStartTime).toBeNull()
  })
})

describe("ShiftOS ne connaît pas de jour facultatif", () => {
  /**
   * Un jour est travaillé ou il ne l'est pas : repos fixe, indisponibilité ou
   * absence. Rien ne doit offrir au moteur un jour qu'il pourrait choisir de ne
   * pas planifier — ce serait une quatrième catégorie, et elle n'existe pas.
   */
  const OPTIONAL_DAY_SHAPES = [
    "optionalDay",
    "optionalDays",
    "flexibleDay",
    "flexibleDays",
    "preferredDayOff",
    "preferredDaysOff",
    "restDayCandidates",
    "jourFacultatif",
  ]

  it("n'expose aucun champ de jour facultatif dans le modèle employé", () => {
    const sources = [
      read("employees", "types", "employee.types.ts"),
      read("employees", "schemas", "employee.schema.ts"),
      read("employees", "components", "tabs", "ContraintesTab.tsx"),
      read("core", "planning-v3", "types", "problem.ts"),
    ]
    for (const source of sources) {
      for (const shape of OPTIONAL_DAY_SHAPES) {
        expect(source).not.toContain(shape)
      }
    }
  })

  it("n'offre à la section avancée que des devoirs datés, jamais un repos", () => {
    // Un sélecteur de jours dans ce repli est légitime tant qu'il impose un
    // DEVOIR — ouvrir, fermer. Il ne doit jamais servir à désigner un jour que
    // le moteur serait libre de ne pas travailler : ce serait le jour
    // facultatif rentré par la fenêtre.
    const tab = read("employees", "components", "tabs", "ContraintesTab.tsx")
    const advanced = tab.slice(tab.indexOf("<CollapsibleSection"))
    const dayFields = new Set(
      [...advanced.matchAll(/name="(\w*[Dd]ays\w*)"/g)].map((match) => match[1])
    )
    expect(dayFields).toEqual(new Set(["openingDays", "closingDays"]))
  })
})

describe("contraintes avancées — les règles fixes", () => {
  it("dit « ne commence pas avant » tant que l'heure est une borne", () => {
    expect(
      advancedConstraintsSummary({
        ...ADVANCED_CONSTRAINTS_DEFAULTS,
        earliestStartTime: "09:00",
      })
    ).toEqual(["Ne commence pas avant 09:00"])
  })

  it("dit « commence à » quand l'heure est imposée", () => {
    // Le repli fermé est le seul endroit où un responsable relit ce réglage :
    // la même phrase pour une borne et pour une heure imposée cacherait la
    // règle la plus dure des deux.
    expect(
      advancedConstraintsSummary({
        ...ADVANCED_CONSTRAINTS_DEFAULTS,
        earliestStartTime: "09:00",
        startTimeIsExact: true,
        latestEndTime: "17:00",
        endTimeIsExact: true,
      })
    ).toEqual(["Commence à 09:00", "Finit à 17:00"])
  })

  it("annonce les jours d'ouverture et de fermeture imposés", () => {
    expect(
      advancedConstraintsSummary({
        ...ADVANCED_CONSTRAINTS_DEFAULTS,
        openingDays: ["monday", "thursday"],
        closingDays: ["saturday"],
      })
    ).toEqual(["Ouvre le lundi et jeudi", "Ferme le samedi"])
  })

  it("les énonce dans l'ordre de la semaine, pas dans celui des clics", () => {
    expect(
      advancedConstraintsSummary({
        ...ADVANCED_CONSTRAINTS_DEFAULTS,
        openingDays: ["saturday", "monday", "wednesday"],
      })
    ).toEqual(["Ouvre le lundi, mercredi et samedi"])
  })

  it("tait les jours d'ouverture quand le droit d'ouvrir est retiré", () => {
    // Annoncer « ouvre le lundi » à quelqu'un qui ne peut pas ouvrir décrirait
    // un planning que le solveur ne produira jamais.
    expect(
      advancedConstraintsSummary({
        ...ADVANCED_CONSTRAINTS_DEFAULTS,
        canOpen: false,
        openingDays: ["monday"],
      })
    ).toEqual(["Ne peut pas ouvrir"])
  })

  it("reste vide quand le salarié suit les règles de la maison", () => {
    expect(hasAdvancedConstraints({ ...ADVANCED_CONSTRAINTS_DEFAULTS, openingDays: [], closingDays: [] })).toBe(false)
  })
})

describe("employé — les règles fixes à la saisie", () => {
  it("refuse d'imposer une heure qu'on n'a pas saisie", () => {
    const parsed = employeeSchema.safeParse(formValues({ startTimeIsExact: true }))
    expect(parsed.success).toBe(false)
  })

  it("refuse un jour d'ouverture qui est un repos fixe", () => {
    const parsed = employeeSchema.safeParse(
      formValues({ openingDays: ["monday"], fixedDaysOff: ["monday"] })
    )
    expect(parsed.success).toBe(false)
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."))).toContain(
      "openingDays"
    )
  })

  it("désigne le champ de fermeture pour une faute de fermeture", () => {
    const parsed = employeeSchema.safeParse(
      formValues({ closingDays: ["monday"], fixedDaysOff: ["monday"] })
    )
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."))).toContain(
      "closingDays"
    )
  })

  it("efface les jours imposés quand le droit correspondant est retiré", () => {
    // Sinon un réglage devenu invisible dans l'écran continuerait de contraindre
    // le solveur, sans que personne puisse le retrouver pour le corriger.
    const parsed = employeeSchema.safeParse(
      formValues({ canOpen: false, openingDays: ["monday"], canClose: false, closingDays: ["tuesday"] })
    )
    expect(parsed.success).toBe(true)
    expect(parsed.success ? parsed.data.openingDays : null).toEqual([])
    expect(parsed.success ? parsed.data.closingDays : null).toEqual([])
  })

  it("accepte une heure imposée accompagnée de son horaire", () => {
    const parsed = employeeSchema.safeParse(
      formValues({ earliestStartTime: "09:00", startTimeIsExact: true })
    )
    expect(parsed.success).toBe(true)
    expect(parsed.success ? parsed.data.startTimeIsExact : null).toBe(true)
  })
})
