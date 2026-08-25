import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { WeekDay } from "@/features/core/models"
import { buildPermanenceCalendar } from "@/features/permanence/calendar/permanence-calendar"
import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import {
  emptyPermanenceMonth,
  permanenceSlotKey,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"
import { PermanenceSheet } from "@/features/permanence/publication/PermanenceSheet"
import { buildPermanenceSheet } from "@/features/permanence/publication/permanence-sheet"

/**
 * La feuille de permanence, telle qu'elle part au papier.
 *
 * Ce qui est garanti ici : le mois est FIGÉ — plus une seule liste déroulante —
 * les cases à pourvoir restent vides et se comptent en tête, et la bande de
 * semaine garde ses trois lignes avec les congés et l'astreinte à cheval.
 */

const january = (opensOn: (day: WeekDay) => boolean = (day) => day !== "sunday") =>
  buildPermanenceCalendar({
    year: 2026,
    month: 1,
    opensOn,
    holidayOf: (date) => (date === "2026-01-01" ? { name: "Jour de l’An", closed: true } : null),
  })

const member = (id: string, first: string, last: string): PermanenceMember => ({
  employeeId: id,
  name: `${first} ${last}`,
  shortName: first,
  canOpen: true,
  canClose: true,
  requiredOpeningDays: [],
  preferredOpeningDays: [],
  requiredClosingDays: [],
  preferredClosingDays: [],
  closingOnlyDays: [],
  maxClosings: null,
  lastResortOpening: false,
  lastResortClosing: false,
  saturdayTurnOver: false,
  daysOff: [],
})

const roster = [member("a", "Adeline", "Roche"), member("b", "Bruno", "Sala")]

const blank = emptyPermanenceMonth(2026, 1, "2026-01-01T00:00:00.000Z")

/** Un mois complet : chaque journée ouverte tenue par quelqu'un. */
function fullMonth(calendar = january()): PermanenceMonth {
  const assignments: Record<string, string> = {}
  calendar.openDays.forEach((day, index) => {
    assignments[permanenceSlotKey(day.date, "opening")] = index % 2 === 0 ? "a" : "b"
    assignments[permanenceSlotKey(day.date, "closing")] = index % 2 === 0 ? "b" : "a"
  })
  return { ...blank, assignments }
}

const build = (
  month: PermanenceMonth,
  calendar = january(),
  leave: ReadonlyMap<string, readonly string[]> = new Map()
) =>
  buildPermanenceSheet({
    calendar,
    month,
    roster,
    paidLeaveByWeek: leave,
    storeName: "Carrefour Market Test",
    printedAtLabel: "Imprimé le 17 août 2026",
  })

const render = (...args: Parameters<typeof build>) =>
  renderToStaticMarkup(<PermanenceSheet sheet={build(...args)} />)

describe("le modèle de la feuille de permanence", () => {
  it("écrit les noms plutôt que les identifiants", () => {
    const sheet = build(fullMonth())

    expect(sheet.weeks[1].opening[0].text).toMatch(/Adeline|Bruno/)
    expect(sheet.weeks[1].opening[0].kind).toBe("person")
  })

  it("laisse vide une case ouverte que personne ne tient, et la compte", () => {
    const sheet = build(blank)

    // 27 journées ouvertes en janvier moins le 1er, chômé : 26 × 2 cases.
    expect(sheet.unfilled).toBe(52)
    expect(sheet.weeks[1].closing[0]).toEqual({ kind: "empty", text: "" })
  })

  it("ne compte aucune case à pourvoir sur un mois complet", () => {
    expect(build(fullMonth()).unfilled).toBe(0)
  })

  it("distingue une journée fermée d’une journée hors du mois", () => {
    const week = build(blank).weeks[0]

    // S1 court du 29 décembre au 3 janvier : décembre est hors mois, et le
    // 1er janvier est chômé.
    expect(week.opening[0]).toEqual({ kind: "outside", text: "—" })
    expect(week.opening[3]).toEqual({ kind: "closed", text: "FERMÉ" })
    expect(week.days[3].holidayName).toBe("Jour de l’An")
  })

  it("reprend les congés de la semaine et l’astreinte", () => {
    const month: PermanenceMonth = {
      ...blank,
      weeks: { "2026-W02": { onCallEmployeeId: "b" } },
    }
    const week = build(month, january(), new Map([["2026-W02", ["a"]]])).weeks[1]

    expect(week.paidLeave).toEqual(["Adeline"])
    expect(week.onCall).toBe("Bruno")
  })

  it("compte l’effectif et les fermetures pour l’en-tête, sans porter de récapitulatif", () => {
    const sheet = build(fullMonth())

    expect(sheet.memberCount).toBe(2)
    // 27 journées ouvertes moins le 1er janvier chômé.
    expect(sheet.closingCount).toBe(26)
  })

  it("donne au dimanche sa colonne quand le magasin ouvre ce jour-là", () => {
    const withSunday = january(() => true)
    const sheet = build(fullMonth(withSunday), withSunday)

    expect(sheet.weeks[1].days).toHaveLength(7)
    expect(sheet.weeks[1].days[6].label).toBe("Dimanche")
  })
})

describe("la feuille de permanence, rendue", () => {
  it("porte l’ancre que les règles d’impression cherchent", () => {
    expect(render(fullMonth())).toContain("data-publication-document")
  })

  it("ne sort aucune liste déroulante au papier", () => {
    const markup = render(fullMonth())

    expect(markup).not.toContain("<select")
    expect(markup).not.toContain("<button")
  })

  it("pose une bande par semaine, congés et astreinte à cheval sur les trois lignes", () => {
    const markup = render(fullMonth())

    expect(markup.match(/<table/g)).toHaveLength(5)
    expect(markup.match(/rowspan="3"/gi)).toHaveLength(10)
    expect(markup).toContain(">S1<")
    expect(markup).toContain(">S5<")
  })

  it("ne sort PAS le récapitulatif au papier", () => {
    // Il sert à arbitrer devant l'écran, pas à être lu devant le tableau : ce
    // qu'on punaise, c'est le mois.
    const markup = render(fullMonth())

    expect(markup).not.toContain("Récapitulatif")
    expect(markup).not.toContain("dont samedis")
    expect(markup).not.toContain("ROCHE")
  })

  it("annonce les cases à pourvoir, et se tait quand il n’y en a pas", () => {
    expect(render(blank)).toContain("52 cases à pourvoir")
    // La légende du pied porte les mêmes mots en permanence ; c'est le BANDEAU
    // qui doit disparaître, et lui seul le compte.
    expect(render(fullMonth())).not.toMatch(/\d+ cases? à pourvoir/)
  })

  it("porte l’en-tête du magasin, le mois et la date d’impression", () => {
    const markup = render(fullMonth())

    expect(markup).toContain("Carrefour Market Test")
    expect(markup).toContain("Permanences · Janvier 2026")
    expect(markup).toContain("2 personnes au tour")
    expect(markup).toContain("26 fermetures")
    expect(markup).toContain("Imprimé le 17 août 2026")
  })

  it("écrit FERMÉ sur un férié chômé, et le nomme en tête de colonne", () => {
    const markup = render(blank)

    expect(markup).toContain("FERMÉ")
    expect(markup).toContain("Jour de l’An")
  })

  it("garde une bande de semaine entière sur la même page", () => {
    // Une bande coupée par la pliure est la seule chose qui rendrait la feuille
    // illisible : le reste peut déborder sur la page suivante.
    const markup = render(fullMonth())

    // Une par bande, et pas une de plus : janvier 2026 en compte cinq.
    expect(markup.match(/break-inside-avoid/g)).toHaveLength(5)
  })
})

/**
 * La couleur de la feuille, figée.
 *
 * Elle obéit à une règle en une phrase — la TEINTE dit le rôle, la VALEUR dit
 * le calendrier — et cette règle ne se voit nulle part à la lecture d'un
 * fichier de composant. Sans ces tests, la première personne qui trouvera
 * l'en-tête des colonnes un peu terne y posera un ambre, et les intersections
 * redeviendront la bouillie qu'elles étaient.
 */
describe("la couleur de la feuille", () => {
  it("donne deux teintes opposées aux deux rôles", () => {
    const markup = render(fullMonth())

    expect(markup).toContain("border-l-amber-600")
    expect(markup).toContain("border-l-teal-700")
    expect(markup).toContain("bg-amber-50")
    expect(markup).toContain("bg-teal-50")
  })

  it("garde les en-têtes de JOURNÉE en gris, jamais en teinte", () => {
    // L'invariant qui protège les intersections : une case ne porte qu'UN fond.
    // Un samedi férié en ligne de fermeture cumulerait sinon trois couleurs.
    //
    // Les en-têtes de journée seulement : la cellule du numéro de semaine porte
    // un pétrole plein, et c'est voulu — elle dit la STRUCTURE de la feuille,
    // pas une exception du calendrier. Le noir, lui, reste au férié.
    const markup = render(fullMonth())
    const thead = markup.slice(markup.indexOf("<thead>"), markup.indexOf("</thead>"))
    const jours = thead.split("<th").filter((cell) => cell.includes('class="block"'))

    expect(jours.length).toBeGreaterThan(0)
    for (const jour of jours) expect(jour).not.toMatch(/bg-amber-|bg-teal-/)
    expect(thead).toContain("bg-neutral-800")
  })

  it("hachure une case à pourvoir, sans rien y écrire", () => {
    // Le modèle laisse la case vide pour qu'aucun signe ne la fasse passer pour
    // un choix. La hachure doit donc rester une AFFAIRE DE FOND.
    const markup = render(blank)

    expect(markup).toContain("repeating-linear-gradient")
    expect(markup).not.toContain("À POURVOIR</td>")
  })

  it("laisse le calendrier l'emporter sur le rôle", () => {
    // Une journée fermée n'attend personne : la teindre aux couleurs du rôle
    // laisserait croire qu'il y manque un nom.
    const markup = render(blank)
    const ferme = markup.slice(markup.indexOf("FERMÉ") - 400, markup.indexOf("FERMÉ"))

    expect(ferme).toContain("bg-neutral-300")
  })

  it("porte une légende, sans quoi la couleur n'est lisible que par qui l'a choisie", () => {
    const markup = render(fullMonth())

    for (const mot of ["Ouverture", "Fermeture", "À pourvoir", "Fermé"]) {
      expect(markup).toContain(mot)
    }
  })
})
