import { describe, expect, it } from "vitest"

import { toStoreConfig, toStoreRow } from "@/features/store/services/store.supabase-repository"
import { WEEK_DAYS } from "@/features/core/models"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

/**
 * Le magasin, aller et retour.
 *
 * C'est la dernière entité passée en base, et celle dont la perte se voit le
 * plus vite : sans magasin lisible, chaque garde de route renvoie vers
 * l'onboarding, et l'application entière devient inaccessible.
 *
 * Le test ne nomme aucun champ dans son contrôle principal : il compare l'objet
 * entier. Une liste oublierait exactement ceux que le découpage oublie.
 */

const store: StoreConfig = {
  name: "Carrefour Market",
  brand: "Carrefour",
  address: "12 rue des Halles",
  city: "Lyon",
  postalCode: "69002",
  country: "France",
  timezone: "Europe/Paris",
  openingHours: WEEK_DAYS.map((day) => ({
    day,
    closed: day === "sunday",
    opensAt: "08:00",
    closesAt: "20:00",
  })),
  planningMode: "dynamic",
  // Le mode dynamique réclame les deux durées : le schéma les impose par
  // `superRefine`, et un jeu d'essai qui les oublie ne prouverait que la
  // capacité du test à passer un `as`.
  minShiftDuration: 120,
  maxShiftDuration: 600,
  timeGranularity: 15,
  splitShiftPolicy: "forbidden",
  minDailyHours: 4,
  maxDailyHours: 10,
  minRestBetweenShifts: 12,
} as StoreConfig

describe("magasin ↔ ligne en base", () => {
  it("ne perd rien en traversant", () => {
    const row = toStoreRow(store)
    const relu = toStoreConfig({ ...row, first_run_completed_at: null } as never)
    expect(relu).toEqual(store)
  })

  it("ne redit pas dans le blob ce qui est une colonne", () => {
    const row = toStoreRow(store)
    for (const promu of ["name", "address", "city", "postalCode", "country", "timezone"]) {
      expect(row.config).not.toHaveProperty(promu)
    }
    expect(row.postal_code).toBe("69002")
  })

  it("emporte les horaires d'ouverture, dont tout le reste dépend", () => {
    // Sans eux, le solveur ne sait pas quand le magasin est ouvert et chaque
    // écran de planning se vide. C'est le champ le plus lourd du blob.
    const row = toStoreRow(store)
    expect((row.config.openingHours as unknown[])).toHaveLength(7)
  })

  it("traite une ligne incomplète comme l'absence de magasin", () => {
    // La ligne créée au rattachement porte des valeurs de remplissage et aucun
    // horaire. La rendre telle quelle laisserait entrer sur des écrans qui
    // tomberaient plus loin ; la refuser envoie terminer la configuration.
    const incomplete = {
      name: "Mon magasin",
      brand: null,
      address: "À compléter",
      city: "À compléter",
      postal_code: "00000",
      country: "France",
      timezone: "Europe/Paris",
      config: {},
      first_run_completed_at: null,
    }
    expect(toStoreConfig(incomplete as never)).toBeNull()
  })
})
