import { describe, expect, it } from "vitest"

import {
  detectSectorRenames,
  employeesAffectedByRenames,
  sectorsAfterRenames,
} from "@/features/sectors/rename"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * Un renommage ne doit détacher personne.
 *
 * Le rattachement est une CHAÎNE, pas une clé : aucun typage ne peut signaler
 * la casse, et aucun message ne relie « le secteur paraît désert » au
 * renommage fait la veille. Ces tests sont donc le seul endroit où le lien
 * entre les deux est écrit.
 */

const person = (id: string, sectors: readonly string[]): EmployeeRecord =>
  ({ id, status: "active", sectors } as unknown as EmployeeRecord)

describe("détecter un renommage", () => {
  it("apparie par identifiant, pas par position", () => {
    const before = [{ id: "s1", name: "Charcuterie" }, { id: "s2", name: "Drive" }]
    const after = [{ id: "s2", name: "Drive" }, { id: "s1", name: "Charcuterie traiteur" }]
    expect(detectSectorRenames(before, after)).toEqual([
      { from: "Charcuterie", to: "Charcuterie traiteur" },
    ])
  })

  it("ignore un secteur nouvellement créé", () => {
    const after = [{ id: "s1", name: "Drive" }, { id: "s2", name: "Caisse" }]
    expect(detectSectorRenames([{ id: "s1", name: "Drive" }], after)).toEqual([])
  })

  it("ne propage pas un nom vidé en cours de saisie", () => {
    // Le champ passe par la chaîne vide entre deux frappes. Propager cet état
    // effacerait le rattachement de toute l'équipe, sans retour possible.
    const before = [{ id: "s1", name: "Drive" }]
    expect(detectSectorRenames(before, [{ id: "s1", name: "" }])).toEqual([])
    expect(detectSectorRenames([{ id: "s1", name: "" }], [{ id: "s1", name: "Drive" }])).toEqual([])
  })
})

describe("appliquer un renommage à une fiche", () => {
  it("remplace l'ancien nom par le nouveau", () => {
    expect(sectorsAfterRenames(["Charcuterie"], [{ from: "Charcuterie", to: "Traiteur" }]))
      .toEqual(["Traiteur"])
  })

  it("garde l'ordre, qui porte la priorité déclarée", () => {
    const result = sectorsAfterRenames(
      ["Drive", "Charcuterie", "Caisse"],
      [{ from: "Charcuterie", to: "Traiteur" }]
    )
    expect(result).toEqual(["Drive", "Traiteur", "Caisse"])
  })

  it("NE CRÉE PAS de doublon quand le nouveau nom est déjà là", () => {
    // C'est l'état réel produit par le piège : l'ancien nom devient invisible
    // dans le sélecteur, le gérant clique sur le nouveau pour réparer, et la
    // fiche se retrouve avec les deux.
    const result = sectorsAfterRenames(
      ["Charcuterie", "Traiteur"],
      [{ from: "Charcuterie", to: "Traiteur" }]
    )
    expect(result).toEqual(["Traiteur"])
  })

  it("laisse intacts les secteurs non concernés", () => {
    expect(sectorsAfterRenames(["Drive"], [{ from: "Charcuterie", to: "Traiteur" }]))
      .toEqual(["Drive"])
  })
})

describe("qui doit être réécrit", () => {
  it("ne rend que les fiches réellement changées", () => {
    const touched = employeesAffectedByRenames(
      [person("a", ["Charcuterie"]), person("b", ["Drive"])],
      [{ from: "Charcuterie", to: "Traiteur" }]
    )
    expect(touched).toHaveLength(1)
    expect(touched[0].employee.id).toBe("a")
    expect(touched[0].sectors).toEqual(["Traiteur"])
  })

  it("rend aussi celle dont le seul changement est la disparition d'un doublon", () => {
    const touched = employeesAffectedByRenames(
      [person("a", ["Charcuterie", "Traiteur"])],
      [{ from: "Charcuterie", to: "Traiteur" }]
    )
    expect(touched).toHaveLength(1)
    expect(touched[0].sectors).toEqual(["Traiteur"])
  })

  it("n'écrit rien quand rien n'a été renommé", () => {
    expect(employeesAffectedByRenames([person("a", ["Drive"])], [])).toEqual([])
  })
})
