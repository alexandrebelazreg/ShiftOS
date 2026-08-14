import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type { PlanningBoardInput } from "@/features/planning/board"
import {
  buildPublicationDocument,
  type PublicationContext,
  type PublicationDayPageVM,
  type PublicationGridPageVM,
} from "@/features/planning/publication/model/publication-document"
import {
  defaultPublicationOptions,
  hasSomethingToPublish,
  toggleDate,
  toggleSector,
  type PublicationOptions,
} from "@/features/planning/publication/model/publication-options"

/**
 * La feuille affichée est testée par son ViewModel, jamais par son rendu.
 *
 * Ce qui doit être garanti ici n'est pas une mise en page — c'est qu'une
 * personne qui vient travailler à 6h le lundi apparaisse bien à 6h le lundi sur
 * le papier, dans le bon rayon, sur la bonne feuille. Le reste est du CSS.
 */

const employee = (id: string, name: string, sectorIds: string[], contractMinutes: number) => ({
  id: id as unknown as EmployeeId,
  name,
  sectorIds,
  contractMinutes,
  rules: [],
})

const shift = (
  id: string,
  employeeId: string,
  date: string,
  startMinutes: number,
  endMinutes: number,
  sectorId = "drive"
) => ({
  id,
  employeeId: employeeId as unknown as EmployeeId,
  sectorId,
  date,
  startMinutes,
  endMinutes,
  workedMinutes: endMinutes - startMinutes,
  segments: [{ startMinutes, endMinutes }],
  opensDay: false,
  closesDay: false,
})

const HOURS = [
  { day: "monday", closed: false, opensAt: "06:00", closesAt: "20:00" },
  { day: "tuesday", closed: false, opensAt: "06:00", closesAt: "20:00" },
  { day: "wednesday", closed: true, opensAt: "", closesAt: "" },
] as const

function input(): PlanningBoardInput {
  return {
    periodStart: "2026-08-10",
    periodEnd: "2026-08-12",
    sectors: [
      { id: "drive", name: "Drive", color: "#2563eb", hours: HOURS },
      { id: "poisson", name: "Poissonnerie", color: "#0d9488", hours: HOURS },
    ],
    employees: [
      employee("luca", "Luca Martin", ["drive"], 960),
      employee("nora", "Nora Petit", ["drive", "poisson"], 960),
    ],
    days: [
      { date: "2026-08-10", weekDay: "monday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
      { date: "2026-08-11", weekDay: "tuesday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
      { date: "2026-08-12", weekDay: "wednesday", closed: true, opensAtMinutes: null, closesAtMinutes: null },
    ],
    shifts: [
      shift("s1", "luca", "2026-08-10", 360, 840),
      // Nora enchaîne deux comptoirs le lundi, sans interruption.
      {
        ...shift("s2", "nora", "2026-08-10", 480, 1200),
        sectorAssignments: [
          { startMinutes: 480, endMinutes: 840, sectorId: "drive" },
          { startMinutes: 840, endMinutes: 1200, sectorId: "poisson" },
        ],
        segments: [{ startMinutes: 480, endMinutes: 1200 }],
      },
      shift("s3", "luca", "2026-08-11", 360, 840),
    ],
    demand: [],
  }
}

const context: PublicationContext = {
  storeName: "Carrefour Market Test",
  storeCity: "Lyon",
  draft: false,
  printedAtLabel: "Édité le 12/08/2026 à 09:00",
}

const options = (patch: Partial<PublicationOptions> = {}): PublicationOptions => ({
  ...defaultPublicationOptions(input(), ["drive", "poisson"]),
  ...patch,
})

const grids = (pages: readonly { kind: string }[]) => pages as readonly PublicationGridPageVM[]
const days = (pages: readonly { kind: string }[]) => pages as readonly PublicationDayPageVM[]

describe("options de publication", () => {
  it("part des rayons regardés et des journées ouvertes", () => {
    const defaults = defaultPublicationOptions(input(), ["drive"])

    expect(defaults.sectorIds).toEqual(["drive"])
    // Le mercredi est fermé : le proposer aurait coché une feuille vide.
    expect(defaults.dates).toEqual(["2026-08-10", "2026-08-11"])
  })

  it("retombe sur tous les rayons quand la sélection ne correspond à rien", () => {
    expect(defaultPublicationOptions(input(), ["inconnu"]).sectorIds).toEqual(["drive", "poisson"])
  })

  it("n’a rien à imprimer sans rayon, ni sans jour en mise en page par jour", () => {
    expect(hasSomethingToPublish(options({ sectorIds: [] }))).toBe(false)
    expect(hasSomethingToPublish(options({ layout: "day", dates: [] }))).toBe(false)
    // Les grilles hebdomadaires ne dépendent pas des jours cochés.
    expect(hasSomethingToPublish(options({ layout: "sector", dates: [] }))).toBe(true)
  })

  it("bascule un jour et un rayon sans toucher au reste", () => {
    const withoutMonday = toggleDate(options(), "2026-08-10")
    expect(withoutMonday.dates).toEqual(["2026-08-11"])
    expect(toggleSector(withoutMonday, "poisson").sectorIds).toEqual(["drive"])
  })
})

describe("l’en-tête du document", () => {
  it("nomme le magasin, la semaine et la période", () => {
    const document = buildPublicationDocument(input(), options(), context)

    expect(document.storeLabel).toBe("Carrefour Market Test")
    expect(document.storeSubLabel).toBe("Lyon")
    expect(document.weekLabel).toBe("Semaine 33")
    expect(document.rangeLabel).toBe("du 10 août au 12 août")
    expect(document.printedAtLabel).toBe("Édité le 12/08/2026 à 09:00")
  })

  it("dit lui-même qu’il est un brouillon", () => {
    const draft = buildPublicationDocument(input(), options(), { ...context, draft: true })
    expect(draft.draftLabel).toBe("Brouillon — ne pas afficher")
    expect(buildPublicationDocument(input(), options(), context).draftLabel).toBeNull()
  })

  it("ne produit aucune feuille sans rayon, et le dit", () => {
    const document = buildPublicationDocument(input(), options({ sectorIds: [] }), context)

    expect(document.pages).toHaveLength(0)
    expect(document.emptyLabel).toContain("Aucun rayon")
  })
})

describe("mise en page par rayons", () => {
  it("sort une feuille par rayon, nommée par lui", () => {
    const document = buildPublicationDocument(input(), options({ layout: "sector" }), context)

    expect(document.pages.map((page) => page.title)).toEqual(["Drive", "Poissonnerie"])
    expect(document.pages.every((page) => page.kind === "grid")).toBe(true)
  })

  it("ne montre sur la feuille d’un rayon que les heures faites dans ce rayon", () => {
    const document = buildPublicationDocument(input(), options({ layout: "sector" }), context)
    const [drive, poisson] = grids(document.pages)

    const noraDrive = drive.rows.find((row) => row.name === "Nora PETIT")
    const noraPoisson = poisson.rows.find((row) => row.name === "Nora PETIT")

    // Le même lundi, lu depuis deux comptoirs : 08:00–14:00 puis 14:00–20:00.
    expect(noraDrive?.cells[0].slots.map((slot) => slot.label)).toEqual(["08:00 – 14:00"])
    expect(noraPoisson?.cells[0].slots.map((slot) => slot.label)).toEqual(["14:00 – 20:00"])
    expect(noraDrive?.totalLabel).toBe("6h")
    expect(noraPoisson?.totalLabel).toBe("6h")
  })

  it("n’écrit pas le nom du rayon dans les cases : il est déjà en titre", () => {
    const [drive] = grids(
      buildPublicationDocument(input(), options({ layout: "sector" }), context).pages
    )
    const slots = drive.rows.flatMap((row) => row.cells.flatMap((cell) => cell.slots))

    expect(slots.length).toBeGreaterThan(0)
    expect(slots.every((slot) => slot.sectorName === null)).toBe(true)
  })

  it("ne garde que les salariés affectés au rayon, repos compris", () => {
    const [, poisson] = grids(
      buildPublicationDocument(input(), options({ layout: "sector" }), context).pages
    )
    const luca = poisson.rows.find((row) => row.name === "Luca MARTIN")

    // Luca n'est pas affecté à la poissonnerie : il n'a pas de ligne du tout.
    expect(luca).toBeUndefined()
    // Nora y est affectée et a une ligne, avec un repos le mardi.
    const nora = poisson.rows.find((row) => row.name === "Nora PETIT")
    expect(nora?.cells[1].emptyLabel).toBe("Repos")
  })

  it("marque la journée fermée et ne compte pas de total pour elle", () => {
    const [drive] = grids(
      buildPublicationDocument(input(), options({ layout: "sector" }), context).pages
    )

    expect(drive.columns[2]).toMatchObject({ dayLabel: "Mercredi", closed: true })
    expect(drive.rows[0].cells[2].emptyLabel).toBe("Fermé")
    expect(drive.totals?.[2]).toBeNull()
  })
})

describe("mise en page par employés", () => {
  it("sort une seule feuille, un salarié par ligne, tous rayons confondus", () => {
    const document = buildPublicationDocument(input(), options({ layout: "employee" }), context)
    const [page] = grids(document.pages)

    expect(document.pages).toHaveLength(1)
    expect(page.title).toBe("Équipe")
    expect(page.subtitle).toBe("Drive · Poissonnerie")
    expect(page.rows.map((row) => row.name)).toEqual(["Luca MARTIN", "Nora PETIT"])
  })

  it("nomme les rayons dans les cases, puisque plusieurs s’y croisent", () => {
    const [page] = grids(
      buildPublicationDocument(input(), options({ layout: "employee" }), context).pages
    )
    const nora = page.rows.find((row) => row.name === "Nora PETIT")

    expect(nora?.cells[0].slots.map((slot) => [slot.sectorName, slot.label])).toEqual([
      ["Drive", "08:00 – 14:00"],
      ["Poissonnerie", "14:00 – 20:00"],
    ])
    // Douze heures ce lundi-là, réparties sur deux comptoirs.
    expect(nora?.totalLabel).toBe("12h")
  })

  it("masque tous les totaux quand on les décoche", () => {
    const [page] = grids(
      buildPublicationDocument(
        input(),
        options({ layout: "employee", showTotals: false }),
        context
      ).pages
    )

    expect(page.totals).toBeNull()
    expect(page.rows.every((row) => row.totalLabel === null)).toBe(true)
  })
})

describe("mise en page par jour", () => {
  it("sort une feuille par jour coché, et seulement ceux-là", () => {
    const document = buildPublicationDocument(
      input(),
      options({ layout: "day", dates: ["2026-08-11"] }),
      context
    )

    expect(document.pages.map((page) => page.title)).toEqual(["Mardi 11/08"])
  })

  it("range la journée comptoir par comptoir, dans l’ordre des prises de poste", () => {
    const [monday] = days(
      buildPublicationDocument(
        input(),
        options({ layout: "day", dates: ["2026-08-10"] }),
        context
      ).pages
    )

    expect(monday.subtitle).toBe("Ouvert 06:00 – 20:00")
    expect(
      monday.groups.map((group) => [
        group.sectorName,
        group.totalLabel,
        group.entries.map((entry) => `${entry.name} ${entry.label}`),
      ])
    ).toEqual([
      ["Drive", "14h", ["Luca MARTIN 06:00 – 14:00", "Nora PETIT 08:00 – 14:00"]],
      ["Poissonnerie", "6h", ["Nora PETIT 14:00 – 20:00"]],
    ])
  })

  it("nomme qui est en repos ce jour-là", () => {
    const [tuesday] = days(
      buildPublicationDocument(
        input(),
        options({ layout: "day", dates: ["2026-08-11"] }),
        context
      ).pages
    )

    expect(tuesday.restLabel).toBe("Repos : Nora PETIT")
    expect(tuesday.groups.map((group) => group.sectorName)).toEqual(["Drive"])
  })

  it("dit qu’une journée fermée est fermée, sans inventer de comptoir", () => {
    const [wednesday] = days(
      buildPublicationDocument(
        input(),
        options({ layout: "day", dates: ["2026-08-12"] }),
        context
      ).pages
    )

    expect(wednesday.emptyLabel).toBe("Fermé ce jour.")
    expect(wednesday.groups).toEqual([])
  })

  it("réclame au moins un jour avant d’imprimer quoi que ce soit", () => {
    const document = buildPublicationDocument(
      input(),
      options({ layout: "day", dates: [] }),
      context
    )

    expect(document.pages).toHaveLength(0)
    expect(document.emptyLabel).toContain("Aucune journée")
  })
})

describe("noms de famille en capitales", () => {
  it("met le nom en capitales et laisse le prénom", () => {
    const [page] = grids(
      buildPublicationDocument(input(), options({ layout: "employee" }), context).pages
    )

    expect(page.rows.map((row) => row.name)).toEqual(["Luca MARTIN", "Nora PETIT"])
  })

  it("applique la même règle aux feuilles du jour et à la ligne des repos", () => {
    const [tuesday] = days(
      buildPublicationDocument(
        input(),
        options({ layout: "day", dates: ["2026-08-11"] }),
        context
      ).pages
    )

    expect(tuesday.groups[0].entries.map((entry) => entry.name)).toEqual(["Luca MARTIN"])
    expect(tuesday.restLabel).toBe("Repos : Nora PETIT")
  })
})

describe("la feuille ne parle pas de rôles", () => {
  it("n’écrit ni ouverture ni fermeture, même sur celui qui ouvre", () => {
    const document = buildPublicationDocument(input(), options({ layout: "sector" }), context)
    const [drive] = grids(document.pages)
    const luca = drive.rows.find((row) => row.name === "Luca MARTIN")

    // Luca prend bien le Drive à son ouverture ; la feuille n'en dit rien,
    // l'heure suffit.
    expect(luca?.cells[0].slots[0].label).toBe("06:00 – 14:00")
    expect(JSON.stringify(document)).not.toMatch(/Ouverture|Fermeture/)
  })

  it("peint chaque plage de la teinte pleine de son rayon, sans ombrage de bord", () => {
    const [page] = grids(
      buildPublicationDocument(input(), options({ layout: "employee" }), context).pages
    )
    const nora = page.rows.find((row) => row.name === "Nora PETIT")
    const slots = nora?.cells[0].slots ?? []

    expect(slots.map((slot) => slot.paint?.backgroundColor)).toEqual([
      "rgba(37, 99, 235, 0.16)",
      "rgba(13, 148, 136, 0.16)",
    ])
    // L'ombrage d'ouverture/fermeture passait par un dégradé : il ne doit plus
    // en rester, sinon un bord dirait encore un rôle que la feuille a retiré.
    expect(slots.every((slot) => slot.paint?.backgroundImage === undefined)).toBe(true)
  })
})

describe("la frise de la feuille du jour", () => {
  it("donne une règle des heures couvrant la journée ouverte", () => {
    const [monday] = days(
      buildPublicationDocument(
        input(),
        options({ layout: "day", dates: ["2026-08-10"] }),
        context
      ).pages
    )

    expect(monday.hours).toHaveLength(14)
    expect(monday.hours[0].label).toBe("06:00")
    expect(monday.hours[13].label).toBe("19:00")
    // Une seule règle, donc des colonnes égales qui font exactement 100 %.
    const total = monday.hours.reduce((sum, hour) => sum + hour.widthPercent, 0)
    expect(total).toBeCloseTo(100, 6)
  })

  it("place chaque barre sur cette règle, en pourcentage de la journée", () => {
    const [monday] = days(
      buildPublicationDocument(
        input(),
        options({ layout: "day", dates: ["2026-08-10"] }),
        context
      ).pages
    )
    const [drive, poisson] = monday.groups

    // Luca ouvre à 06:00 : sa barre part du bord gauche.
    expect(drive.entries[0]).toMatchObject({ leftPercent: 0 })
    // Nora entre à 08:00 sur 06:00–20:00, soit 2h sur 14h.
    expect(drive.entries[1].leftPercent).toBeCloseTo((2 / 14) * 100, 6)
    // Puis 14:00–20:00 en poissonnerie : la fin colle au bord droit.
    const last = poisson.entries[0]
    expect(last.leftPercent + last.widthPercent).toBeCloseTo(100, 6)
  })
})
