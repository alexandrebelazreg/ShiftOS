import { describe, expect, it } from "vitest"

import { createEmptySector } from "@/features/sectors"
import { eligibleEmployees, marketZoneSectors } from "@/features/planning/flow/generation-scope"
import { preparePlanningGeneration } from "@/features/planning/flow/planning-flow"
import { buildPlanningProblemV3 } from "@/features/core/planning-v3/problem-builder"
import { employee, sectorStoreConfig, smallSector, SMALL_SECTOR_SCOPE } from "@/features/planning/__tests__/planning-fixtures"

const sector = (id: string, name: string, marketZone = false) => ({
  ...createEmptySector(id),
  name,
  marketZone,
})

describe("périmètre multi-secteur — priorités salarié", () => {
  const drive = sector("drive", "Drive")
  const fruits = sector("fruits", "Fruits et légumes", true)
  const charcuterie = sector("charcuterie", "Charcuterie", true)
  const fromage = sector("fromage", "Fromage", true)
  const team = [
    employee("drive-first", { sectors: ["Drive", "Charcuterie"] }),
    employee("charcuterie-first", { sectors: ["Charcuterie", "Fromage"] }),
    employee("fruits-first", { sectors: ["Fruits et légumes", "Charcuterie"] }),
    employee("fromage-first", { sectors: ["Fromage"] }),
    employee("secondary-only", { sectors: ["Accueil", "Charcuterie"] }),
  ]

  it("un secteur seul utilise uniquement les salariés qui l'ont en priorité 1", () => {
    expect(eligibleEmployees(team, [charcuterie]).map((person) => person.id)).toEqual([
      "charcuterie-first",
    ])
  })

  it("Zone marché prend tous les contrats prioritaires du groupe mais jamais un Drive-first", () => {
    expect(eligibleEmployees(team, [fruits, charcuterie, fromage]).map((person) => person.id)).toEqual([
      "charcuterie-first",
      "fruits-first",
      "fromage-first",
    ])
  })

  it("construit le groupe uniquement depuis les cases cochées", () => {
    expect(marketZoneSectors([drive, fruits, charcuterie, fromage]).map((item) => item.id)).toEqual([
      "fruits",
      "charcuterie",
      "fromage",
    ])
  })

  it("compte une seule fois chaque contrat complet dans une génération Zone marché", () => {
    const fruitSector = { ...smallSector(), id: "fruits", name: "Fruits et légumes", marketZone: true }
    const charcuterieSector = { ...smallSector(), id: "charcuterie", name: "Charcuterie", marketZone: true }
    const members = [
      employee("fruit-priority", {
        weeklyHours: 20,
        weeklyMinutes: 1_200,
        sectors: [fruitSector.name, charcuterieSector.name],
      }),
      employee("charcuterie-priority", {
        weeklyHours: 20,
        weeklyMinutes: 1_200,
        sectors: [charcuterieSector.name, fruitSector.name],
      }),
    ]
    const prepared = preparePlanningGeneration({
      store: sectorStoreConfig(),
      employees: members,
      sectors: [fruitSector, charcuterieSector],
      scope: SMALL_SECTOR_SCOPE,
    })
    expect(prepared.status).toBe("ready")
    if (prepared.status !== "ready") return

    const built = buildPlanningProblemV3(prepared.generationInput)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.problem.employees).toHaveLength(2)
    expect(built.problem.employees.reduce((sum, person) => sum + person.contractMinutes, 0)).toBe(2_400)
    expect(Object.fromEntries(built.problem.employees.map((person) => [String(person.id), person.allowedSectorIds]))).toEqual({
      "charcuterie-priority": ["charcuterie", "fruits"],
      "fruit-priority": ["fruits", "charcuterie"],
    })
  })
})
