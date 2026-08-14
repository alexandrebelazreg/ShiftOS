import { describe, expect, it } from "vitest"

import { holidayProfileOf } from "@/features/planning/holidays/model/employee-holiday-profile"

describe("le profil d’un salarié face aux jours fériés", () => {
  it("suit la fiche quand aucun statut particulier ne s’applique", () => {
    expect(holidayProfileOf({ scheduleType: "variable" })).toMatchObject({
      scheduleType: "variable",
      forfaitJour: false,
      scheduleTypeForcedByStudent: false,
    })
    expect(holidayProfileOf({ scheduleType: "fixed" }).scheduleType).toBe("fixed")
  })

  it("traite un étudiant en horaires fixes, même si sa fiche dit variable", () => {
    // « Pour planifier correctement les étudiants, ils doivent être paramétrés
    // en Horaire Fixe. » On le déduit plutôt que de le faire ressaisir.
    expect(holidayProfileOf({ scheduleType: "variable", student: true })).toMatchObject({
      scheduleType: "fixed",
      scheduleTypeForcedByStudent: true,
    })
  })

  it("ne signale rien quand l’étudiant est déjà en fixe", () => {
    expect(
      holidayProfileOf({ scheduleType: "fixed", student: true }).scheduleTypeForcedByStudent
    ).toBe(false)
  })

  it("lit une fiche ancienne comme variable, sans statut particulier", () => {
    // Aucun champ : c'est le cas de toutes les fiches enregistrées avant les
    // jours fériés, et elles doivent rester lisibles telles quelles.
    expect(holidayProfileOf({})).toEqual({
      scheduleType: "variable",
      forfaitJour: false,
      scheduleTypeForcedByStudent: false,
    })
  })

  it("porte le forfait jour sans toucher au type d’horaire", () => {
    expect(holidayProfileOf({ scheduleType: "variable", forfaitJour: true })).toMatchObject({
      scheduleType: "variable",
      forfaitJour: true,
    })
  })
})
