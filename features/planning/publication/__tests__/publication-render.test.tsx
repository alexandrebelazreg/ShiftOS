import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { EmployeeId } from "@/features/core/models"
import type { PlanningBoardInput } from "@/features/planning/board"
import { buildPublicationDocument } from "@/features/planning/publication/model/publication-document"
import { defaultPublicationOptions } from "@/features/planning/publication/model/publication-options"
import { PlanningPublicationDocument } from "@/features/planning/publication/ui/PlanningPublicationDocument"

/**
 * Les feuilles rendues, pas seulement calculées.
 *
 * Le ViewModel prouve les chiffres ; il ne prouve pas qu'une feuille sort du
 * gabarit sans lever, ni que le total est passé sous le nom, ni qu'aucun mot
 * retiré ne traîne encore dans le balisage. Trois choses qu'on ne voit que sur
 * le papier — ou dans le HTML qui le produit.
 */

const employee = (id: string, name: string, sectorIds: string[]) => ({
  id: id as unknown as EmployeeId,
  name,
  sectorIds,
  contractMinutes: 960,
  rules: [],
})

const HOURS = [
  { day: "monday", closed: false, opensAt: "06:00", closesAt: "20:00" },
] as const

function input(): PlanningBoardInput {
  return {
    periodStart: "2026-08-10",
    periodEnd: "2026-08-10",
    sectors: [
      { id: "drive", name: "Drive", color: "#2563eb", hours: HOURS },
      { id: "poisson", name: "Poissonnerie", color: "#0d9488", hours: HOURS },
    ],
    employees: [
      employee("luca", "Luca Martin", ["drive"]),
      employee("nora", "Nora Petit", ["drive", "poisson"]),
    ],
    days: [
      { date: "2026-08-10", weekDay: "monday", closed: false, opensAtMinutes: 360, closesAtMinutes: 1200 },
    ],
    shifts: [
      {
        id: "s1",
        employeeId: "luca" as unknown as EmployeeId,
        sectorId: "drive",
        date: "2026-08-10",
        startMinutes: 360,
        endMinutes: 840,
        workedMinutes: 480,
        segments: [{ startMinutes: 360, endMinutes: 840 }],
        opensDay: true,
        closesDay: false,
      },
      {
        id: "s2",
        employeeId: "nora" as unknown as EmployeeId,
        sectorId: "poisson",
        date: "2026-08-10",
        startMinutes: 840,
        endMinutes: 1200,
        workedMinutes: 360,
        sectorAssignments: [{ startMinutes: 840, endMinutes: 1200, sectorId: "poisson" }],
        segments: [{ startMinutes: 840, endMinutes: 1200 }],
        opensDay: false,
        closesDay: true,
      },
    ],
    demand: [],
  }
}

/** « Par employés » ne se construit plus ici : il lit plusieurs semaines. */
function render(layout: "sector" | "day"): string {
  const publication = buildPublicationDocument(
    input(),
    { ...defaultPublicationOptions(input(), ["drive", "poisson"]), layout },
    {
      storeName: "Carrefour Market Test",
      storeCity: "Lyon",
      draft: false,
      printedAtLabel: "Édité le 12/08/2026 à 09:00",
    }
  )
  return renderToStaticMarkup(<PlanningPublicationDocument publication={publication} />)
}

describe("les feuilles se rendent", () => {
  it("porte l’ancre sur laquelle les règles d’impression effacent le reste", () => {
    // Renommer cet attribut sortirait la barre latérale sur le papier.
    expect(render("sector")).toContain("data-publication-document")
  })

  it("écrit le total de la semaine sous le nom, et non dans une colonne", () => {
    const html = render("sector")

    // Le nom et son total dans la même cellule d'en-tête de ligne.
    expect(html).toMatch(/Luca MARTIN<\/span><span[^>]*>8h<\/span>/)
    // Et plus aucune colonne « Total » dans l'en-tête du tableau.
    expect(html).not.toMatch(/>Total<\/th>/)
    // Le pied « Total du jour » reste : c'est une autre question, et une option.
    expect(html).toContain("Total du jour")
  })

  it("ne laisse traîner ni ouverture ni fermeture dans le balisage", () => {
    for (const layout of ["sector", "day"] as const) {
      expect(render(layout)).not.toMatch(/Ouverture|Fermeture/)
    }
  })

  it("dessine la frise du jour et une barre placée par salarié", () => {
    const html = render("day")

    // Quatorze graduations de 06:00 à 19:00, la journée entière.
    expect(html).toContain("06:00")
    expect(html).toContain("19:00")
    // Nora prend la poissonnerie à 14:00 : 8 h après l'ouverture sur 14 h.
    expect(html).toContain(`margin-left:${(8 / 14) * 100}%`)
    expect(html).toContain("14:00 – 20:00")
  })

  it("sort une feuille par rayon, chacune avec son en-tête de magasin", () => {
    const html = render("sector")

    expect(html.match(/Carrefour Market Test/g)).toHaveLength(2)
    expect(html).toContain("Drive")
    expect(html).toContain("Poissonnerie")
  })

  it("écrit le férié en toutes lettres sur la feuille, jamais en sigle", () => {
    const withHoliday: PlanningBoardInput = {
      ...input(),
      holidays: [
        { date: "2026-08-10", name: "Fête Nationale", opening: "travaille", volunteerIds: [] },
      ],
      storeOpensSundays: false,
      // Quelqu'un qui NE VIENT PAS ce jour-là : c'est sa case, restée vide, qui
      // doit porter le motif. Luca et Nora travaillent, la leur porte un horaire.
      employees: [
        ...input().employees,
        { ...employee("iris", "Iris Blanc", ["drive"]), scheduleType: "fixed" as const },
      ],
    }
    const publication = buildPublicationDocument(
      withHoliday,
      // Lu sur les feuilles de rayon : la mise en page « par employés » ne
      // vit plus ici, elle lit plusieurs semaines et a son propre constructeur.
      { ...defaultPublicationOptions(withHoliday, ["drive", "poisson"]), layout: "sector" },
      {
        storeName: "Test",
        storeCity: null,
        draft: false,
        printedAtLabel: "Édité",
        // Le Drive est le PREMIER rayon d'Iris : elle figure sur sa feuille
        // bien qu'elle n'y ait aucune heure, et c'est sa case vide qui porte
        // le motif du férié. Sans ce rattachement elle n'aurait plus de ligne,
        // et le mur ne dirait plus pourquoi elle ne vient pas.
        primarySectorByEmployee: { iris: "drive" },
      }
    )
    const html = renderToStaticMarkup(<PlanningPublicationDocument publication={publication} />)

    // Le nom du férié en tête de colonne, et le traitement dans la case.
    expect(html).toContain("Fête Nationale")
    expect(html).toContain("Férié non travaillé")
    // Aucun sigle : ce qui se lit au mur se lit en français.
    expect(html).not.toMatch(/>HF<|>RH<|>DH<|>JF<|>DF<|>PJ</)
  })

  it("montre le bandeau du brouillon uniquement sur un brouillon", () => {
    const publication = buildPublicationDocument(
      input(),
      defaultPublicationOptions(input(), ["drive"]),
      {
        storeName: "Test",
        storeCity: null,
        draft: true,
        printedAtLabel: "Édité",
      }
    )
    const html = renderToStaticMarkup(<PlanningPublicationDocument publication={publication} />)

    expect(html).toContain("Brouillon — ne pas afficher")
    expect(render("sector")).not.toContain("Brouillon")
  })
})
