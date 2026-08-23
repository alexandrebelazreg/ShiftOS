import { describe, expect, it } from "vitest"

import { isEmpty, readLocalSnapshot, summarize } from "@/features/migration/local-data"

/**
 * Le relevé de ce qu'un poste détient.
 *
 * C'est la seule étape de la reprise qu'aucun rattrapage ne sauve : ce qui n'est
 * pas relevé n'est pas copié, et personne ne s'en aperçoit avant d'en avoir
 * besoin. Les cas ci-dessous sont ceux qui font perdre des données en silence.
 */

function storageWith(entries: Record<string, string>): Storage {
  const data = new Map(Object.entries(entries))
  const keys = () => [...data.keys()]
  return {
    get length() {
      return data.size
    },
    key: (index: number) => keys()[index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => data.clear(),
  } as Storage
}

describe("relevé d'un poste", () => {
  it("ne trouve rien dans un navigateur vierge", () => {
    const snapshot = readLocalSnapshot(storageWith({}))
    expect(isEmpty(snapshot)).toBe(true)
  })

  it("relève les plannings par préfixe, sans faire confiance à leur index", () => {
    // Un index qui a perdu une entrée ferait disparaître un planning qui existe
    // pourtant — et une reprise est le pire moment pour croire un index.
    const snapshot = readLocalSnapshot(
      storageWith({
        shiftos_planning_index: JSON.stringify(["planning_a"]),
        shiftos_planning_a: JSON.stringify({ id: "planning_a", state: {}, periodStart: "2026-08-17" }),
        shiftos_planning_b: JSON.stringify({ id: "planning_b", state: {}, periodStart: "2026-08-24" }),
      })
    )
    expect(snapshot.plannings).toHaveLength(2)
  })

  it("n'avale pas l'index lui-même comme s'il était un planning", () => {
    // `shiftos_planning_index` partage le préfixe des plannings. Sans le filtre
    // sur la présence d'un état, il serait repris comme une semaine vide.
    const snapshot = readLocalSnapshot(
      storageWith({ shiftos_planning_index: JSON.stringify(["planning_a"]) })
    )
    expect(snapshot.plannings).toHaveLength(0)
  })

  it("n'avale pas la campagne active comme si c'était une campagne", () => {
    const snapshot = readLocalSnapshot(
      storageWith({
        shiftos_paid_leave_active_campaign: "leave_1",
        shiftos_paid_leave_campaign_index: JSON.stringify(["leave_1"]),
        shiftos_paid_leave_campaign_leave_1: JSON.stringify({ id: "leave_1", name: "Été" }),
      })
    )
    expect(snapshot.campaigns).toHaveLength(1)
    expect(snapshot.activeCampaignId).toBe("leave_1")
  })

  it("lit les secteurs sous leur clé héritée", () => {
    // La clé s'appelle encore `first_run_setup`. La chercher sous un nom plus
    // logique ne trouverait rien, et la reprise partirait sans les secteurs.
    const snapshot = readLocalSnapshot(
      storageWith({
        shiftos_first_run_setup: JSON.stringify([{ id: "sector_1", name: "Drive" }]),
      })
    )
    expect(snapshot.sectors).toHaveLength(1)
  })

  it("survit à une entrée illisible sans perdre les autres", () => {
    const snapshot = readLocalSnapshot(
      storageWith({
        shiftos_employees: "{ pas du json",
        shiftos_absences: JSON.stringify([{ id: "a1" }]),
      })
    )
    expect(snapshot.employees).toHaveLength(0)
    expect(snapshot.absences).toHaveLength(1)
  })

  it("compte ce qu'il montrera au gérant", () => {
    const snapshot = readLocalSnapshot(
      storageWith({
        shiftos_employees: JSON.stringify([{ id: "e1" }, { id: "e2" }]),
        shiftos_holidays: JSON.stringify({ "2026-05-01": { opening: "chome" } }),
      })
    )
    const counts = Object.fromEntries(summarize(snapshot).map((c) => [c.label, c.count]))
    expect(counts["Salariés"]).toBe(2)
    expect(counts["Décisions sur les fériés"]).toBe(1)
    expect(counts["Secteurs"]).toBe(0)
  })
})
