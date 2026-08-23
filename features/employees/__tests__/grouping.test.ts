import { describe, expect, it } from "vitest"

import {
  groupEmployeesBySector,
  isEmployeeDisplayMode,
  UNASSIGNED_GROUP_KEY,
} from "@/features/employees/grouping"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * Ranger l'équipe par secteur, sans faire disparaître personne.
 *
 * Le risque d'un regroupement est toujours le même : quelqu'un tombe entre deux
 * cases et n'apparaît nulle part. Ici deux cas le provoquent — le salarié sans
 * secteur, et celui rattaché à un secteur qui n'est plus configuré. Les deux
 * sont testés parce que les deux passeraient inaperçus à l'écran : on ne
 * remarque pas une absence.
 */

const person = (id: string, sectors: readonly string[]): EmployeeRecord =>
  ({ id, firstName: id, lastName: "", status: "active", sectors } as unknown as EmployeeRecord)

describe("équipe rangée par secteur", () => {
  it("suit l'ordre des secteurs configurés", () => {
    const groups = groupEmployeesBySector(
      [person("a", ["Drive"]), person("b", ["Accueil"])],
      ["Accueil", "Drive"]
    )
    expect(groups.map((group) => group.label)).toEqual(["Accueil", "Drive"])
  })

  it("montre un polyvalent sous CHACUN de ses secteurs", () => {
    // C'est la question à laquelle ce mode répond : « qui peut tenir ce rayon ».
    // Ne le montrer que sous son secteur principal répondrait à une autre.
    const groups = groupEmployeesBySector([person("a", ["Drive", "Accueil"])], ["Accueil", "Drive"])
    expect(groups.every((group) => group.employees.length === 1)).toBe(true)
  })

  it("garde un secteur configuré mais vide, au lieu de l'omettre", () => {
    // C'est exactement le manque que la mise en route reproche ; le cacher ici
    // obligerait à le découvrir ailleurs.
    const groups = groupEmployeesBySector([person("a", ["Drive"])], ["Accueil", "Drive"])
    const accueil = groups.find((group) => group.label === "Accueil")
    expect(accueil?.employees).toEqual([])
  })

  it("rassemble à la fin ceux qui n'ont aucun secteur", () => {
    const groups = groupEmployeesBySector([person("a", [])], ["Drive"])
    expect(groups[groups.length - 1].key).toBe(UNASSIGNED_GROUP_KEY)
    expect(groups[groups.length - 1].employees).toHaveLength(1)
  })

  it("n'escamote pas un secteur cité par une fiche mais absent de la configuration", () => {
    // Le rattachement est une chaîne : renommer un secteur laisse des fiches
    // pointant vers l'ancien nom. Les taire ferait disparaître des gens.
    const groups = groupEmployeesBySector([person("a", ["Ancien rayon"])], ["Drive"])
    expect(groups.map((group) => group.label)).toContain("Ancien rayon")
  })

  it("ne retient pas un mode d'affichage inventé", () => {
    expect(isEmployeeDisplayMode("cards")).toBe(true)
    expect(isEmployeeDisplayMode("mosaique")).toBe(false)
    expect(isEmployeeDisplayMode(null)).toBe(false)
  })
})
