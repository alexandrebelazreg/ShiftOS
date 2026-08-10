import { describe, expect, it } from "vitest"

import {
  describeWeek,
  hasPlanningForWeek,
  marketZoneSelectionState,
  needsWeekChangeConfirmation,
  primaryPlanningAction,
  resolveTargetWeek,
  resolveWeekChangeChoice,
  summarizeSectorSelection,
  type SectorChoice,
} from "@/features/planning/board/model/header-controls"

const sector = (id: string, name: string, selected: boolean): SectorChoice => ({ id, name, selected })

describe("résumé des secteurs — libellé fermé", () => {
  const all = [
    sector("drive", "Drive", false),
    sector("marche", "Zone Marché", false),
    sector("caisse", "Caisse", false),
  ]
  const pick = (...ids: string[]) => all.map((s) => ({ ...s, selected: ids.includes(s.id) }))

  it("aucun secteur", () => {
    expect(summarizeSectorSelection(pick())).toBe("Aucun secteur")
  })

  it("un secteur → son nom", () => {
    expect(summarizeSectorSelection(pick("drive"))).toBe("Drive")
  })

  it("deux secteurs → noms joints", () => {
    expect(summarizeSectorSelection(pick("drive", "marche"))).toBe("Drive + Zone Marché")
  })

  it("trois sur plus → compte", () => {
    const four = [...all, sector("frais", "Frais", false)]
    const selected = four.map((s) => ({ ...s, selected: s.id !== "frais" }))
    expect(summarizeSectorSelection(selected)).toBe("3 secteurs")
  })

  it("tous les secteurs → libellé dédié, pas un compte", () => {
    expect(summarizeSectorSelection(pick("drive", "marche", "caisse"))).toBe("Tous les secteurs")
  })

  it("ne code aucune combinaison en dur — noms arbitraires", () => {
    const custom = [sector("a", "Alpha", true), sector("b", "Bravo", true), sector("c", "Charlie", false)]
    expect(summarizeSectorSelection(custom)).toBe("Alpha + Bravo")
  })
})

describe("sélection groupée Zone marché", () => {
  it("est cochée seulement lorsque tous les secteurs configurés du groupe le sont", () => {
    expect(marketZoneSelectionState([
      { ...sector("drive", "Drive", true), marketZone: false },
      { ...sector("fruits", "Fruits", true), marketZone: true },
      { ...sector("charcuterie", "Charcuterie", true), marketZone: true },
    ])).toEqual({ count: 2, selected: true })

    expect(marketZoneSelectionState([
      { ...sector("fruits", "Fruits", true), marketZone: true },
      { ...sector("charcuterie", "Charcuterie", false), marketZone: true },
    ])).toEqual({ count: 2, selected: false })
  })
})

describe("planning de la semaine sélectionnée — divergence", () => {
  it("S30 sélectionnée + planning S30 → un planning est affichable", () => {
    expect(hasPlanningForWeek("2026-07-20", "2026-07-20")).toBe(true)
  })

  it("S31 sélectionnée + seul planning S30 → aucun planning affichable", () => {
    // La grille S30 ne doit jamais apparaître sous l'en-tête S31.
    expect(hasPlanningForWeek("2026-07-27", "2026-07-20")).toBe(false)
  })

  it("aucun planning généré → aucune semaine n'en a", () => {
    expect(hasPlanningForWeek("2026-07-20", null)).toBe(false)
  })

  it("retour sur S30 → le planning S30 est de nouveau affichable", () => {
    // Après S30 → S31 → S30, la comparaison redevient vraie.
    expect(hasPlanningForWeek("2026-07-20", "2026-07-20")).toBe(true)
  })
})

describe("action principale — Générer vs Régénérer, par semaine", () => {
  it("S30 sélectionnée + planning S30 → Régénérer", () => {
    expect(primaryPlanningAction(hasPlanningForWeek("2026-07-20", "2026-07-20"))).toBe("regenerate")
  })

  it("S31 sélectionnée + seul planning S30 → Générer", () => {
    expect(primaryPlanningAction(hasPlanningForWeek("2026-07-27", "2026-07-20"))).toBe("generate")
  })

  it("Générer tant qu'aucun planning n'existe", () => {
    expect(primaryPlanningAction(false)).toBe("generate")
  })

  it("Régénérer quand la semaine sélectionnée a son planning", () => {
    expect(primaryPlanningAction(true)).toBe("regenerate")
  })
})

describe("enregistrer / publier — indisponibles sans planning pour la semaine", () => {
  it("indisponibles quand la semaine sélectionnée n'a pas de planning", () => {
    // Save/Publish gate on the very same week-specific answer as the grid.
    expect(hasPlanningForWeek("2026-07-27", "2026-07-20")).toBe(false)
  })

  it("disponibles quand la semaine sélectionnée a son planning", () => {
    expect(hasPlanningForWeek("2026-07-20", "2026-07-20")).toBe(true)
  })
})

describe("confirmation de changement de semaine", () => {
  it("aucune confirmation sans modification", () => {
    expect(needsWeekChangeConfirmation(false)).toBe(false)
  })

  it("confirmation dès qu'il y a des modifications", () => {
    expect(needsWeekChangeConfirmation(true)).toBe(true)
  })
})

describe("issue du choix de changement de semaine", () => {
  it("annulation : ne change rien", () => {
    expect(resolveWeekChangeChoice("cancel", false)).toEqual({
      changeWeek: false,
      discardLocalEdits: false,
    })
  })

  it("changer sans enregistrer : change et abandonne le local", () => {
    expect(resolveWeekChangeChoice("discard", false)).toEqual({
      changeWeek: true,
      discardLocalEdits: true,
    })
  })

  it("enregistrer puis changer : change seulement si l'enregistrement réussit", () => {
    expect(resolveWeekChangeChoice("save", true)).toEqual({
      changeWeek: true,
      discardLocalEdits: true,
    })
    expect(resolveWeekChangeChoice("save", false)).toEqual({
      changeWeek: false,
      discardLocalEdits: false,
    })
  })
})

describe("préparation de la semaine cible", () => {
  it("recule d'une semaine sur le lundi", () => {
    expect(resolveTargetWeek("2026-07-20", { type: "previous" })).toBe("2026-07-13")
  })

  it("avance d'une semaine sur le lundi", () => {
    expect(resolveTargetWeek("2026-07-20", { type: "next" })).toBe("2026-07-27")
  })

  it("normalise une sélection directe sur le lundi de sa semaine", () => {
    expect(resolveTargetWeek("2026-07-20", { type: "select", week: "2026-07-23" })).toBe("2026-07-20")
  })
})

describe("libellé de semaine", () => {
  it("donne le numéro ISO et la plage en toutes lettres", () => {
    expect(describeWeek("2026-07-20")).toEqual({
      title: "Semaine 30",
      range: "20 juillet → 26 juillet",
    })
  })
})
