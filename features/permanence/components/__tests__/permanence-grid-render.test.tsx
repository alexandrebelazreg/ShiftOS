import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { WeekDay } from "@/features/core/models"
import { buildPermanenceCalendar } from "@/features/permanence/calendar/permanence-calendar"
import { PermanenceMonthGrid } from "@/features/permanence/components/PermanenceMonthGrid"
import type { PermanenceMember } from "@/features/permanence/domain/permanence-roster"
import {
  emptyPermanenceMonth,
  permanenceSlotKey,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"

/**
 * La grille, telle qu'elle s'affiche.
 *
 * Ce qui est garanti ici n'est pas une esthétique — c'est que la feuille ait la
 * FORME du classeur qu'elle remplace : une bande par semaine, les trois lignes
 * dans l'ordre, les deux colonnes de droite, et une case fermée qui ne se
 * remplit pas. Une mise en page de tableau est précisément ce qu'un modèle de
 * données ne peut pas prouver.
 */

const january = (opensOn: (day: WeekDay) => boolean = (day) => day !== "sunday") =>
  buildPermanenceCalendar({ year: 2026, month: 1, opensOn, holidayOf: () => null })

const member = (id: string, first: string, last: string): PermanenceMember => ({
  employeeId: id,
  name: `${first} ${last}`,
  shortName: first,
  requiredOpeningDays: [],
  preferredOpeningDays: [],
  requiredClosingDays: [],
  preferredClosingDays: [],
  daysOff: [],
})

const roster: readonly PermanenceMember[] = [
  member("a", "Adeline", "Roche"),
  member("b", "Bruno", "Sala"),
]

const noop = () => undefined

function render(
  month: PermanenceMonth,
  calendar = january(),
  leave: ReadonlyMap<string, readonly string[]> = new Map()
): string {
  return renderToStaticMarkup(
    <PermanenceMonthGrid
      calendar={calendar}
      month={month}
      roster={roster}
      paidLeaveByWeek={leave}
      onAssign={noop}
      onToggleRest={noop}
      onOnCall={noop}
    />
  )
}

const blank = emptyPermanenceMonth(2026, 1, "2026-01-01T00:00:00.000Z")

describe("la grille des permanences", () => {
  it("pose une bande par semaine, numérotée comme la feuille", () => {
    const markup = render(blank)

    expect(markup.match(/<table/g)).toHaveLength(5)
    for (const week of ["S1", "S2", "S3", "S4", "S5"]) {
      expect(markup).toContain(`>${week}</th>`)
    }
  })

  it("porte les trois lignes, dans l’ordre où on les lit", () => {
    const markup = render(blank)

    expect(markup.indexOf("Ouverture")).toBeLessThan(markup.indexOf("Fermeture"))
    expect(markup.indexOf("Fermeture")).toBeLessThan(markup.indexOf("Repos"))
  })

  it("garde les colonnes CP et Astreinte de la feuille, sur toute la hauteur de la bande", () => {
    const markup = render(blank)

    expect(markup).toContain(">CP</th>")
    expect(markup).toContain(">Astreinte</th>")
    // Congés et astreinte se posent à la semaine : leurs cases couvrent les
    // trois lignes plutôt que d'être répétées trois fois.
    expect(markup.match(/rowspan="3"/gi)).toHaveLength(10)
  })

  it("remplit la colonne CP depuis les congés, sans rien à saisir", () => {
    // S2 court du 5 au 11 janvier 2026, soit la semaine ISO 2026-W02.
    const markup = render(blank, january(), new Map([["2026-W02", ["b"]]]))

    expect(markup).toContain("Bruno")
    // Une lecture, pas une saisie : aucune liste déroulante de congés.
    expect(markup).not.toContain("Congés de la semaine")
    expect(markup).toContain('aria-label="Astreinte de la semaine 2"')
  })

  it("n’écrit dans la colonne CP que les congés de gens du tour", () => {
    const markup = render(blank, january(), new Map([["2026-W02", ["quelqu-un-d-autre"]]]))

    expect(markup).not.toContain("Hors tour")
  })

  it("annonce chaque journée par son jour et sa date", () => {
    const markup = render(blank)

    expect(markup).toContain("Jeudi")
    expect(markup).toContain(">1/01<")
    expect(markup).toContain(">31/01<")
  })

  it("barre d’un tiret les journées des semaines à cheval", () => {
    // S1 commence le 29 décembre : lundi, mardi et mercredi n'appartiennent pas
    // au mois et ne portent ni date ni liste déroulante.
    expect(render(blank)).toContain(">—</span>")
  })

  it("ne met pas de liste déroulante sur une journée fermée", () => {
    const closedOnMonday = january((day) => day !== "sunday" && day !== "monday")
    const markup = render(blank, closedOnMonday)

    expect(markup).toContain("Fermé")
    // Quatre lundis fermés, deux cases chacun, plus la journée hors mois.
    const openDays = closedOnMonday.openDays.length
    expect(markup.match(/aria-label="(Ouverture|Fermeture) du /g)).toHaveLength(openDays * 2)
  })

  it("montre le nom affecté, pas seulement la case", () => {
    const filled: PermanenceMonth = {
      ...blank,
      assignments: { [permanenceSlotKey("2026-01-05", "closing")]: "a" },
      rest: { "2026-01-06": ["a"] },
    }
    const markup = render(filled)

    expect(markup).toContain('aria-label="Fermeture du 5/01"')
    expect(markup).toContain("Adeline")
    expect(markup).toContain("Retirer Adeline des repos du 6/01")
  })

  it("ajoute la colonne du dimanche quand le magasin ouvre ce jour-là", () => {
    expect(render(blank)).not.toContain("Dimanche")
    expect(render(blank, january(() => true))).toContain("Dimanche")
  })
})
