import { describe, expect, it } from "vitest"

import { memoryStore } from "@/features/core/shared/key-value-store"
import { createEmployeeRepository } from "@/features/employees/persistence/employee.repository"
import {
  toRecord,
  toRow,
  type EmployeeRow,
} from "@/features/employees/persistence/employee.supabase-repository"

/**
 * L'aller-retour entre une fiche et sa ligne en base.
 *
 * C'est le point le plus risqué de la mise en base, et le plus silencieux : une
 * fiche porte une soixantaine de champs, dix sont promus en colonnes, le reste
 * part dans un `jsonb`. Un champ oublié dans le découpage ne lève rien — il
 * disparaît, et on s'en aperçoit le jour où un manager cherche pourquoi
 * quelqu'un n'ouvre plus jamais le magasin.
 *
 * Le test n'énumère donc AUCUN champ : il compare la fiche entière avant et
 * après. Une liste de champs à vérifier oublierait exactement ceux que le
 * découpage oublie.
 */

const store = memoryStore()

async function fabriquerFiche() {
  const repository = createEmployeeRepository(store, {
    now: () => "2026-02-01T10:00:00.000Z",
    generateId: () => "emp_source",
  })
  return repository.create({
    firstName: "Nadia",
    lastName: "Berger",
    phone: "0102030405",
    email: "nadia@exemple.fr",
    status: "active",
    weeklyHours: 35,
    contractType: "full_time",
    sectors: ["Drive", "Accueil"],
    competencies: { Drive: ["Préparation"], Accueil: ["Standard"] },
    canOpen: true,
    canClose: false,
    splitShiftAllowed: true,
    fixedDaysOff: ["sunday"],
    forbiddenDays: ["saturday"],
    maxOpenings: 3,
    maxClosings: 1,
    preferOpening: true,
    preferClosing: false,
    notes: "Ne ferme jamais le vendredi",
  })
}

describe("fiche salarié ↔ ligne en base", () => {
  it("ne perd aucun champ en traversant les deux traducteurs", async () => {
    const fiche = await fabriquerFiche()

    const ligne = toRow(fiche, "magasin-test")
    // La base rend l'identifiant et les horodatages ; on les remet tels quels
    // pour comparer ce que le découpage a vraiment transporté.
    const relue = toRecord({
      ...ligne,
      id: fiche.id,
      created_at: fiche.createdAt,
      updated_at: fiche.updatedAt,
    } as unknown as EmployeeRow)

    expect(relue).toEqual(fiche)
  })

  it("ne redit pas dans le blob ce qui est déjà une colonne", async () => {
    const fiche = await fabriquerFiche()
    const ligne = toRow(fiche, "magasin-test")

    // Une valeur présente aux deux endroits finit par diverger, et c'est le
    // blob périmé qu'on lit ensuite.
    for (const promu of ["firstName", "lastName", "email", "status", "weeklyMinutes", "id"]) {
      expect(ligne.profile).not.toHaveProperty(promu)
    }
    expect(ligne.first_name).toBe("Nadia")
    expect(ligne.weekly_minutes).toBe(2100)
  })

  it("emporte bien les champs qui ne sont PAS des colonnes", async () => {
    const fiche = await fabriquerFiche()
    const ligne = toRow(fiche, "magasin-test")

    expect(ligne.profile).toMatchObject({
      sectors: ["Drive", "Accueil"],
      canOpen: true,
      canClose: false,
      maxOpenings: 3,
      notes: "Ne ferme jamais le vendredi",
      forbiddenDays: ["saturday"],
    })
  })

  it("scelle la ligne sur le magasin qu'on lui donne", async () => {
    const fiche = await fabriquerFiche()
    expect(toRow(fiche, "magasin-a").store_id).toBe("magasin-a")
    expect(toRow(fiche, "magasin-b").store_id).toBe("magasin-b")
  })
})
