import { describe, expect, it } from "vitest"

import { resolveGenerationScope } from "@/features/planning/flow/generation-scope"
import { employee, sectorStoreConfig, smallSector } from "@/features/planning/__tests__/planning-fixtures"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * Un rayon de zone marché doit pouvoir se générer SEUL.
 *
 * La zone marché est un périmètre de génération commode, pas une contrainte :
 * rien n'oblige à traiter les comptoirs ensemble. Un gérant peut vouloir
 * refaire le seul fromage sans toucher au reste, et le menu des rayons le
 * permet — chaque comptoir y a sa propre case, à côté du raccourci de groupe.
 *
 * L'effectif retenu suit alors la règle ordinaire : le PREMIER choix de chacun.
 * Quelqu'un qui a le fromage en second est polyvalent, il n'en est pas le
 * titulaire ; l'embarquer reviendrait à le retirer de son propre rayon pour
 * une génération qui ne le concerne pas.
 *
 * Écrit après que le gérant l'a demandé comme une évolution : la garantie
 * existait, rien ne l'énonçait, et rien ne la protégeait d'une régression.
 */
describe("zone marché — un comptoir seul", () => {
  const fromage = { ...smallSector(), id: "fromage", name: "Fromage", marketZone: true }
  const boucherie = { ...smallSector(), id: "boucherie", name: "Boucherie", marketZone: true }

  const team: EmployeeRecord[] = [
    employee("titulaire-fromage", { sectors: ["Fromage", "Boucherie"] } as Partial<EmployeeRecord>),
    employee("titulaire-boucherie", { sectors: ["Boucherie", "Fromage"] } as Partial<EmployeeRecord>),
    employee("ailleurs", { sectors: ["Drive"] } as Partial<EmployeeRecord>),
  ]

  const scopeFor = (selectedSectorIds: readonly string[]) =>
    resolveGenerationScope({
      store: sectorStoreConfig(),
      sectors: [fromage, boucherie],
      employees: team,
      selectedSectorIds,
    })

  it("accepte un seul comptoir, sans exiger toute la zone", () => {
    const verdict = scopeFor(["fromage"])
    expect(verdict.kind, verdict.kind === "refused" ? verdict.message : "").toBe("generate")
    if (verdict.kind !== "generate") return
    expect(verdict.scope.sectorIds).toEqual(["fromage"])
  })

  it("n'embarque que ceux qui l'ont en PREMIER choix", () => {
    const verdict = scopeFor(["fromage"])
    if (verdict.kind !== "generate") throw new Error("périmètre refusé")
    // Le titulaire de la boucherie sait tenir le fromage, mais le prendre ici
    // le retirerait de son propre comptoir pour une semaine qui ne le concerne pas.
    expect(verdict.scope.employees.map((person) => person.id)).toEqual(["titulaire-fromage"])
  })

  it("réunit les titulaires des deux quand la zone entière est demandée", () => {
    const verdict = scopeFor(["fromage", "boucherie"])
    if (verdict.kind !== "generate") throw new Error("périmètre refusé")
    expect(verdict.scope.employees.map((person) => person.id).sort()).toEqual([
      "titulaire-boucherie",
      "titulaire-fromage",
    ])
  })
})
