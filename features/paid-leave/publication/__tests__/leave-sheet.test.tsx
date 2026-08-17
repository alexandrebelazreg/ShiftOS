import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { buildLeaveSheet } from "@/features/paid-leave/publication/leave-sheet"
import { PaidLeaveSheet } from "@/features/paid-leave/publication/PaidLeaveSheet"
import type { PaidLeaveCampaign, PaidLeaveWeekId } from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * La feuille des congés, telle qu'elle part au mur.
 *
 * Ce qui est garanti ici n'est pas une mise en page — c'est qu'on puisse
 * CHERCHER UN NOM : groupé par rayon, rangé alphabétiquement, chaque rayon
 * reconnaissable à sa couleur.
 */

const employee = (id: string, first: string, last: string, sector: string): EmployeeRecord =>
  ({
    id,
    firstName: first,
    lastName: last,
    status: "active",
    sectors: [sector],
    weeklyHours: 35,
    weeklyMinutes: 2100,
  }) as unknown as EmployeeRecord

const sector = (id: string, name: string, color?: string): SectorDemandConfiguration =>
  ({ id, name, color, status: "active" }) as unknown as SectorDemandConfiguration

const request = (wish1: PaidLeaveWeekId[], wish2: PaidLeaveWeekId[] = []) => ({
  employeeId: "x",
  wish1,
  wish2,
  wish3: [],
})

function campaign(patch: Partial<PaidLeaveCampaign> = {}): PaidLeaveCampaign {
  return {
    id: "c1",
    name: "Été 2026",
    year: 2026,
    // Trois semaines à cheval sur juillet et août.
    period: { kind: "custom", startWeek: 30, endWeek: 32 },
    status: "editing",
    requests: {},
    grants: {},
    employeeSettings: {},
    reinforcementPools: [],
    solution: null,
    validatedSnapshot: null,
    coverage: {},
    ...patch,
  } as unknown as PaidLeaveCampaign
}

const sheetOf = (patch: Partial<PaidLeaveCampaign> = {}, employees?: EmployeeRecord[]) =>
  buildLeaveSheet({
    campaign: campaign(patch),
    employees: employees ?? [
      employee("e1", "Nora", "Petit", "Drive"),
      employee("e2", "Luca", "Martin", "Drive"),
      employee("e3", "Elsa", "Nguyen", "Accueil"),
    ],
    sectors: [sector("drive", "Drive", "#2563eb"), sector("accueil", "Accueil", "#0d9488")],
    storeName: "Carrefour Market Test",
    printedAtLabel: "Édité le 12/08/2026",
  })

describe("l’organisation de la feuille", () => {
  it("groupe par rayon, les rayons dans l’ordre alphabétique", () => {
    // « Accueil » avant « Drive » : sur un mur, on cherche un rayon par son nom.
    expect(sheetOf().groups.map((group) => group.sectorName)).toEqual(["Accueil", "Drive"])
  })

  it("range les salariés par nom de famille dans chaque rayon", () => {
    // MARTIN avant PETIT : on cherche « Martin », pas « Luca ».
    const drive = sheetOf().groups.find((group) => group.sectorName === "Drive")

    expect(drive?.rows.map((row) => row.name)).toEqual(["Luca MARTIN", "Nora PETIT"])
  })

  it("porte la couleur réglée pour chaque rayon", () => {
    const groups = sheetOf().groups

    expect(groups.map((group) => group.color)).toEqual(["#0d9488", "#2563eb"])
  })

  it("relègue en dernier ceux dont le rayon n’est pas reconnu", () => {
    // Une anomalie de fiche, pas un rayon du magasin.
    const sheet = sheetOf({}, [
      employee("e1", "Luca", "Martin", "Drive"),
      employee("e9", "Sami", "Roche", "Rayon disparu"),
    ])

    expect(sheet.groups.map((group) => group.sectorName)).toEqual(["Drive", "Sans rayon"])
  })

  it("écarte les salariés inactifs", () => {
    const inactive = {
      ...employee("e1", "Luca", "Martin", "Drive"),
      status: "inactive",
    } as EmployeeRecord

    expect(sheetOf({}, [inactive]).groups).toEqual([])
  })
})

describe("les colonnes et leur bandeau de mois", () => {
  it("aligne une colonne par semaine de la période", () => {
    expect(sheetOf().columns.map((column) => column.weekNumber)).toEqual([30, 31, 32])
  })

  it("coiffe les semaines de leur mois, en regroupant les colonnes", () => {
    // Le mois d'une semaine est celui de son JEUDI : sans cette règle, une
    // semaine à cheval basculerait selon son lundi.
    const months = sheetOf().months

    expect(months.reduce((sum, month) => sum + month.span, 0)).toBe(3)
    expect(months.map((month) => month.label)).toEqual(["Juillet", "Août"])
  })
})

describe("ce que dit une ligne", () => {
  it("marque le rang du vœu sur chaque semaine accordée", () => {
    const drive = sheetOf({
      requests: { e2: request(["2026-W30"], ["2026-W31"]) } as never,
      grants: { e2: ["2026-W31"] },
    }).groups.find((group) => group.sectorName === "Drive")
    const luca = drive?.rows.find((row) => row.name === "Luca MARTIN")

    expect(luca?.cells.map((cell) => [cell.granted, cell.rank])).toEqual([
      [false, null],
      [true, 2],
      [false, null],
    ])
  })

  it("compte l’accordé sur le demandé", () => {
    const drive = sheetOf({
      requests: { e2: request(["2026-W30", "2026-W31"]) } as never,
      grants: { e2: ["2026-W30"] },
    }).groups.find((group) => group.sectorName === "Drive")

    expect(drive?.rows.find((row) => row.name === "Luca MARTIN")).toMatchObject({
      grantedCount: 1,
      requestedCount: 2,
    })
  })

  it("laisse le rang à null sur une semaine posée hors de tout vœu", () => {
    const drive = sheetOf({
      requests: { e2: request(["2026-W30"]) } as never,
      grants: { e2: ["2026-W32"] },
    }).groups.find((group) => group.sectorName === "Drive")
    const cells = drive?.rows.find((row) => row.name === "Luca MARTIN")?.cells

    expect(cells?.[2]).toMatchObject({ granted: true, rank: null })
  })
})

describe("l’en-tête et le total", () => {
  it("nomme le magasin, la campagne et la période", () => {
    const sheet = sheetOf()

    expect(sheet.storeName).toBe("Carrefour Market Test")
    expect(sheet.campaignName).toBe("Été 2026")
    expect(sheet.periodLabel).toContain("3 semaines")
  })

  it("se dit proposition tant que la campagne n’est pas validée", () => {
    expect(sheetOf().draft).toBe(true)
    expect(sheetOf().statusLabel).toBe("Proposition — non validée")

    const validated = sheetOf({
      status: "validated",
      validatedSnapshot: { validatedAt: "2026-06-01T10:00:00.000Z" } as never,
    })
    expect(validated.draft).toBe(false)
    expect(validated.statusLabel).toContain("Validé le")
  })

  it("totalise les semaines accordées", () => {
    const sheet = sheetOf({ grants: { e1: ["2026-W30"], e2: ["2026-W31", "2026-W32"] } })

    expect(sheet.grantedTotal).toBe(3)
  })
})

describe("la feuille se rend", () => {
  const html = () => renderToStaticMarkup(<PaidLeaveSheet sheet={sheetOf({
    requests: { e2: request(["2026-W30"]) } as never,
    grants: { e2: ["2026-W30"] },
  })} />)

  it("porte l’ancre sur laquelle les règles d’impression effacent le reste", () => {
    expect(html()).toContain("data-publication-document")
  })

  it("réclame l’A3 par sa page nommée", () => {
    // `leave-sheet` est la classe que `@page a3-landscape` cible : la renommer
    // ferait sortir un tableau de vingt-six colonnes sur de l’A4.
    expect(html()).toContain("leave-sheet")
  })

  it("écrit les rayons, les noms et les mois", () => {
    const rendered = html()

    expect(rendered).toContain("Accueil")
    expect(rendered).toContain("Luca MARTIN")
    expect(rendered).toContain("Juillet")
  })

  it("n’écrit aucun rang de vœu : la case pleine suffit", () => {
    // Le rang est une information de PILOTAGE. Celui qui cherche son nom au mur
    // veut savoir quelles semaines il est absent ; « V2 » sur sa ligne ne lui
    // apprend qu'une chose, qu'un autre a été préféré.
    const rendered = html()

    expect(rendered).not.toMatch(/>V[123]</)
    // Et la case accordée porte bien la couleur de son rayon.
    expect(rendered).toMatch(/<td style="background-color:rgba\(37, 99, 235/)
  })

  it("peint les rayons de leur couleur", () => {
    expect(html()).toContain("rgba(37, 99, 235")
  })

  it("annonce une proposition non validée sur le papier", () => {
    expect(html()).toContain("ne pas afficher")
  })
})
