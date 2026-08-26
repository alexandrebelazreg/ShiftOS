import { describe, expect, it } from "vitest"

import { latestPerSectorScope } from "@/features/planning/publication/model/latest-plannings"

/**
 * Le défaut que ce filtre existe pour empêcher, dans ses chiffres réels.
 *
 * Une semaine de 36h45 sortait à 73h30 sur la feuille d'un salarié. Le total
 * avait l'air d'un bug du calcul d'heures ; c'était la LECTURE qui était
 * double, parce que régénérer un rayon crée un enregistrement de plus sans
 * effacer le précédent.
 */

const planning = (id: string, sectorIds: readonly string[] | undefined, updatedAt: string) => ({
  id,
  periodStart: "2026-09-07",
  updatedAt,
  ...(sectorIds ? { sectorIds } : {}),
})

describe("latestPerSectorScope", () => {
  it("ne garde que la dernière version d'un même périmètre", () => {
    const kept = latestPerSectorScope([
      planning("drive-v1", ["drive"], "2026-09-01T08:00:00.000Z"),
      planning("drive-v2", ["drive"], "2026-09-02T08:00:00.000Z"),
    ])

    expect(kept.map((entry) => entry.id)).toEqual(["drive-v2"])
  })

  it("garde le plus récent quel que soit l'ordre reçu", () => {
    const recent = planning("drive-v2", ["drive"], "2026-09-02T08:00:00.000Z")
    const old = planning("drive-v1", ["drive"], "2026-09-01T08:00:00.000Z")

    expect(latestPerSectorScope([recent, old])[0].id).toBe("drive-v2")
    expect(latestPerSectorScope([old, recent])[0].id).toBe("drive-v2")
  })

  /** Deux rayons de la même semaine sont légitimement simultanés. */
  it("garde côte à côte deux périmètres différents", () => {
    const kept = latestPerSectorScope([
      planning("drive", ["drive"], "2026-09-01T08:00:00.000Z"),
      planning("marche", ["poisson", "charcuterie"], "2026-09-01T09:00:00.000Z"),
    ])

    expect(kept.map((entry) => entry.id).sort()).toEqual(["drive", "marche"])
  })

  it("reconnaît le même périmètre quel que soit l'ordre des rayons", () => {
    const kept = latestPerSectorScope([
      planning("v1", ["poisson", "charcuterie"], "2026-09-01T08:00:00.000Z"),
      planning("v2", ["charcuterie", "poisson"], "2026-09-02T08:00:00.000Z"),
    ])

    expect(kept.map((entry) => entry.id)).toEqual(["v2"])
  })

  /**
   * Un enregistrement d'avant le champ `sectorIds` ne dit pas ce qu'il couvre.
   * On ne peut donc ni le confondre avec un autre, ni décider qu'il le
   * remplace : il forme son propre périmètre et survit seul.
   */
  it("ne fait remplacer par personne un enregistrement sans rayon nommé", () => {
    const kept = latestPerSectorScope([
      planning("ancien-1", undefined, "2026-09-01T08:00:00.000Z"),
      planning("ancien-2", undefined, "2026-09-02T08:00:00.000Z"),
      planning("drive", ["drive"], "2026-09-03T08:00:00.000Z"),
    ])

    expect(kept.map((entry) => entry.id).sort()).toEqual(["ancien-1", "ancien-2", "drive"])
  })

  it("ne rend rien quand on ne lui donne rien", () => {
    expect(latestPerSectorScope([])).toEqual([])
  })
})
