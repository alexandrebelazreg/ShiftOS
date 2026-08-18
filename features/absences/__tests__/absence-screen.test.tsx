import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { buildAbsenceMonth } from "@/features/absences/calendar/absence-month"
import { AbsenceForm } from "@/features/absences/components/AbsenceForm"
import {
  AbsenceLegend,
  AbsenceMonthGrid,
} from "@/features/absences/components/AbsenceMonthGrid"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * L'écran des absences, tel qu'il s'affiche.
 *
 * Ce qui est garanti ici n'est pas une esthétique : qu'une case couverte porte
 * bien une couleur, qu'un champ sans objet ne soit pas posé, et que le papier
 * attendu soit annoncé au moment où on peut encore le réclamer. Un modèle ne
 * prouve rien de tout cela.
 */

const employees = [
  { id: "1", firstName: "Adeline", lastName: "Roche", status: "active" },
  { id: "2", firstName: "Bruno", lastName: "Sala", status: "active" },
] as unknown as EmployeeRecord[]

function absence(patch: Partial<AbsenceRecord> & { id: string }): AbsenceRecord {
  return {
    employeeId: "1",
    type: "sick_leave",
    start: "2026-03-09",
    end: "2026-03-13",
    ...patch,
  }
}

const month = (absences: readonly AbsenceRecord[]) =>
  buildAbsenceMonth({
    year: 2026,
    month: 3,
    employees,
    absences,
    opensOn: (day) => day !== "sunday",
  })

const grid = (absences: readonly AbsenceRecord[]) =>
  renderToStaticMarkup(<AbsenceMonthGrid month={month(absences)} onPick={() => {}} />)

const form = () =>
  renderToStaticMarkup(
    <AbsenceForm employees={employees} today="2026-03-10" onSubmit={() => {}} onCancel={() => {}} />
  )

describe("la grille du mois", () => {
  it("pose une ligne par salarié et une colonne par jour", () => {
    const markup = grid([])
    expect(markup).toContain("Adeline Roche")
    expect(markup).toContain("Bruno Sala")
    // 31 jours + la colonne des noms + la colonne des totaux. Le motif exige un
    // séparateur : `<th` seul compte aussi le `<thead>`.
    expect(markup.match(/<th[ >]/g)).toHaveLength(33)
  })

  it("colore les cases couvertes, et elles seules", () => {
    const markup = grid([absence({ id: "a" })])
    const cells = markup.match(/<button/g) ?? []
    // Du 9 au 13 mars : cinq journées, cinq cases cliquables.
    expect(cells).toHaveLength(5)
    expect(markup).toContain("bg-rose-200")
  })

  it("grise les dimanches, où le magasin est fermé", () => {
    // Le 1er mars 2026 est un dimanche : sa colonne porte le fond des jours fermés.
    expect(grid([])).toContain("bg-muted/60")
  })

  it("marque la demi-journée d'une lettre et d'un demi-fond", () => {
    const markup = grid([
      absence({ id: "a", start: "2026-03-09", end: "2026-03-09", halfDay: "afternoon" }),
    ])
    expect(markup).toContain(">A</button>")
    expect(markup).toContain("bg-gradient-to-t")
  })

  it("dit qu'un congé de campagne ne se corrige pas ici", () => {
    const markup = grid([
      absence({ id: "validated-paid-leave:1:2026-W11", type: "paid_leave" }),
    ])
    expect(markup).toContain("campagne de congés, non modifiable ici")
  })

  it("ne montre en légende que les motifs présents ce mois-ci", () => {
    const markup = renderToStaticMarkup(<AbsenceLegend month={month([absence({ id: "a" })])} />)
    expect(markup).toContain("Maladie")
    expect(markup).not.toContain("Formation")
    expect(renderToStaticMarkup(<AbsenceLegend month={month([])} />)).toBe("")
  })
})

describe("le formulaire", () => {
  it("pose deux champs de date, remplis au montage", () => {
    // Les valeurs par défaut ne s'écrivent pas dans le HTML : react-hook-form
    // laisse les champs NON CONTRÔLÉS et les remplit par référence une fois
    // montés. Ce que ce rendu peut prouver, c'est que les deux champs existent ;
    // la règle de dates, elle, se vérifie sur le schéma.
    const markup = form()
    expect(markup).toContain('id="start" type="date"')
    expect(markup).toContain('id="end" type="date"')
  })

  it("annonce le papier attendu avant la saisie, pas après", () => {
    // C'est au moment d'enregistrer l'arrêt qu'on peut encore le réclamer.
    const markup = form()
    expect(markup).toContain("Justificatif attendu")
    expect(markup).toContain("Arrêt de travail")
    expect(markup).toContain("sous 2 jours")
  })

  it("propose les douze motifs, et aucune fin ouverte", () => {
    const markup = form()
    expect(markup.match(/<option/g)).toHaveLength(2 + 12)
    expect(markup).not.toContain("Fin inconnue")
    expect(markup).toContain("Prolongeable ensuite")
  })

  it("propose la demi-journée sur une journée unique, jamais les heures", () => {
    // Le formulaire s'ouvre sur un seul jour et un motif compté en journées.
    const markup = form()
    expect(markup).toContain("Journée entière")
    expect(markup).toContain("Après-midi")
    expect(markup).not.toContain("Heures prises")
  })
})
