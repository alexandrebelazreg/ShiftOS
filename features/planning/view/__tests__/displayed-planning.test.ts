import { describe, expect, it } from "vitest"

import {
  planningIdToOpen,
  savedPlanningFor,
  type DisplayablePlanning,
} from "@/features/planning/view/displayed-planning"

/**
 * L'articulation entre l'adresse et l'affichage.
 *
 * Les deux moitiés marchaient : le tableau de bord ouvrait bien le planning
 * qu'il désignait, et l'écran retrouvait bien celui de la semaine affichée.
 * C'est leur JOINT qui cédait — l'adresse gardait la parole pour toute la
 * visite — et une panne de joint ne se voit dans aucun des deux tests qui
 * couvrent les moitiés. D'où celui-ci.
 */

const record = (
  id: string,
  periodStart: string,
  sectorIds: readonly string[] | undefined,
  updatedAt: string
): DisplayablePlanning => ({ id, periodStart, updatedAt, ...(sectorIds ? { sectorIds } : {}) })

describe("planningIdToOpen", () => {
  it("demande d'ouvrir le planning que porte l'adresse", () => {
    expect(planningIdToOpen("planning_37", null)).toBe("planning_37")
  })

  it("ne demande rien quand l'adresse n'en porte aucun", () => {
    expect(planningIdToOpen(undefined, null)).toBeNull()
  })

  it("ne redemande plus rien une fois ce planning honoré", () => {
    expect(planningIdToOpen("planning_37", "planning_37")).toBeNull()
  })

  it("rouvre malgré tout si l'adresse en désigne un AUTRE", () => {
    expect(planningIdToOpen("planning_36", "planning_37")).toBe("planning_36")
  })
})

describe("savedPlanningFor", () => {
  const records = [
    record("marche_37", "2026-09-07", ["boucherie", "poissonnerie"], "2026-09-01T10:00:00Z"),
    record("drive_36", "2026-08-31", ["drive"], "2026-08-25T10:00:00Z"),
    record("drive_35", "2026-08-24", ["drive"], "2026-08-18T10:00:00Z"),
  ]

  it("retrouve le planning de la semaine et des rayons affichés", () => {
    expect(savedPlanningFor(records, "2026-08-31", ["drive"])?.id).toBe("drive_36")
  })

  /**
   * Le défaut signalé, dans son parcours exact : ouvrir la zone marché de la
   * S37 depuis le tableau de bord, choisir le Drive, revenir d'une semaine.
   * L'écran n'affichait rien alors que la S36 du Drive était enregistrée.
   */
  it("retrouve une semaine antérieure après un changement de rayon", () => {
    expect(planningIdToOpen("marche_37", "marche_37")).toBeNull()
    expect(savedPlanningFor(records, "2026-08-31", ["drive"])?.id).toBe("drive_36")
    expect(savedPlanningFor(records, "2026-08-24", ["drive"])?.id).toBe("drive_35")
  })

  it("ignore l'ordre des rayons dans la sélection", () => {
    expect(
      savedPlanningFor(records, "2026-09-07", ["poissonnerie", "boucherie"])?.id
    ).toBe("marche_37")
  })

  it("n'accepte pas un planning couvrant d'autres rayons", () => {
    expect(savedPlanningFor(records, "2026-09-07", ["boucherie"])).toBeNull()
    expect(savedPlanningFor(records, "2026-08-31", ["drive", "boucherie"])).toBeNull()
  })

  it("ne rend rien pour une semaine sans planning", () => {
    expect(savedPlanningFor(records, "2026-09-14", ["drive"])).toBeNull()
  })

  it("préfère le plus récemment enregistré", () => {
    const rewritten = [
      ...records,
      record("drive_36_bis", "2026-08-31", ["drive"], "2026-08-26T09:00:00Z"),
    ]
    expect(savedPlanningFor(rewritten, "2026-08-31", ["drive"])?.id).toBe("drive_36_bis")
  })

  /** Un enregistrement d'avant le champ `sectorIds` ne s'apparie à personne. */
  it("écarte un enregistrement qui ne nomme aucun rayon", () => {
    const legacy = [record("ancien", "2026-08-31", undefined, "2026-08-25T10:00:00Z")]
    expect(savedPlanningFor(legacy, "2026-08-31", ["drive"])).toBeNull()
    expect(savedPlanningFor(legacy, "2026-08-31", [])?.id).toBe("ancien")
  })
})
