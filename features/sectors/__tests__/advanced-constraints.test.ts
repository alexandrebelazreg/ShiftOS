import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { beforeAll, describe, expect, it } from "vitest"

import { WEEK_DAYS } from "@/features/core/models"
import type { SectorDemandConfiguration } from "@/features/sectors"
import {
  createEmptySector,
  createSectorRepository,
  SECTOR_RULE_DEFAULTS,
} from "@/features/sectors"

const sectorsRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (name: string) => readFileSync(join(sectorsRoot, name), "utf8")

/** A minimal in-memory `Storage`, enough for the repository's two methods. */
function storageWith(value: unknown): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>([["shiftos_first_run_setup", JSON.stringify(value)]])
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, next) => void store.set(key, next),
  }
}

/**
 * A sector persisted BEFORE the « Contraintes avancées » block existed.
 *
 * Deliberately written out as a literal rather than derived from
 * `createEmptySector`: derived, it would silently acquire every field this test
 * is supposed to prove it survives without.
 */
const LEGACY_SECTOR = {
  id: "drive",
  name: "Drive",
  status: "active",
  color: "#2563eb",
  description: "",
  hours: WEEK_DAYS.map((day) => ({ day, closed: day === "sunday", opensAt: "06:00", closesAt: "20:00" })),
  coverage: { standardDay: null, profiles: {} },
  weeklyDistribution: Object.fromEntries(WEEK_DAYS.map((day) => [day, day === "sunday" ? 0 : 17])),
  workEveryNonFixedRestDay: true,
  shiftRules: {
    inheritMinimumShiftDuration: false,
    minimumShiftDuration: 240,
    maximumDailyDuration: 600,
    timeIncrement: 15,
    splitShiftAllowed: true,
    maximumSplitDuration: 90,
  },
  competencies: [],
}

describe("secteur — un ancien enregistrement traverse la migration", () => {
  // Chargé une fois avant les cas : la lecture est désormais asynchrone, et une
  // constante de `describe` ne peut plus l'attendre.
  let migrated: SectorDemandConfiguration
  beforeAll(async () => {
    migrated = (await createSectorRepository(storageWith([LEGACY_SECTOR])).list())[0]
  })

  it("se charge sans erreur", () => {
    expect(migrated).toBeDefined()
    expect(migrated.name).toBe("Drive")
  })

  it("conserve ce que l'ancien secteur disait déjà", () => {
    expect(migrated.shiftRules.minimumShiftDuration).toBe(240)
    expect(migrated.shiftRules.maximumDailyDuration).toBe(600)
    expect(migrated.shiftRules.splitShiftAllowed).toBe(true)
    expect(migrated.shiftRules.maximumSplitDuration).toBe(90)
    expect(migrated.workEveryNonFixedRestDay).toBe(true)
  })

  it("acquiert les règles en vigueur qu'il ne portait pas", () => {
    // `undefined` serait lu par le builder comme « règle non appliquée » : une
    // journée de dix heures d'un seul tenant redeviendrait légale par omission.
    expect(migrated.shiftRules.maximumContinuousDuration).toBe(SECTOR_RULE_DEFAULTS.maximumContinuousDuration)
    expect(migrated.shiftRules.minimumSplitDuration).toBe(SECTOR_RULE_DEFAULTS.minimumSplitDuration)
    expect(migrated.shiftRules.maximumSplitsPerDay).toBe(SECTOR_RULE_DEFAULTS.maximumSplitsPerDay)
    expect(migrated.shiftRules.minimumOpeningsPerDay).toBe(SECTOR_RULE_DEFAULTS.minimumOpeningsPerDay)
    expect(migrated.shiftRules.requiredClosingsPerDay).toBe(SECTOR_RULE_DEFAULTS.requiredClosingsPerDay)
    expect(migrated.shiftRules.minimumRestMinutes).toBe(SECTOR_RULE_DEFAULTS.minimumRestMinutes)
  })

  it("n'invente aucun plancher de présence", () => {
    // Une règle capable de REFUSER un planning ne s'acquiert pas par migration.
    expect(migrated.minimumPresence).toEqual([])
  })

  it("reçoit une équité désactivée avec l'historique par défaut", () => {
    expect(migrated.closingFairness).toEqual({
      balanceClosings: false,
      balanceSaturdayClosings: false,
      lookbackWeeks: SECTOR_RULE_DEFAULTS.lookbackWeeks,
    })
  })

  it("ne perd pas les planchers d'un secteur qui en déclarait", async () => {
    const withFloor = (await createSectorRepository(
      storageWith([{ ...LEGACY_SECTOR, minimumPresence: [{ id: "p", days: [], from: null, to: null, employees: 1 }] }])
    ).list())[0]
    expect(withFloor.minimumPresence).toEqual([{ id: "p", days: [], from: null, to: null, employees: 1 }])
  })

  it("survit à un aller-retour d'enregistrement", async () => {
    const storage = storageWith([LEGACY_SECTOR])
    const repository = createSectorRepository(storage)
    await repository.save(await repository.list())
    expect((await createSectorRepository(storage).list())[0]).toEqual(migrated)
  })
})

describe("secteur — la section « Contraintes avancées »", () => {
  const view = read("SectorAdvancedConstraints.tsx")

  // Cinq et non six : le « mode de génération » est hors périmètre, faute de
  // moteur capable de résoudre en mode bibliothèque — voir plus bas.
  it("découpe le bloc en cinq sous-sections repliables", () => {
    for (const title of [
      "1 · Couverture opérationnelle",
      "2 · Durées et coupures",
      "3 · Ouvertures et fermetures",
      "4 · Équité des fermetures",
      "5 · Repos et enchaînements",
    ]) {
      expect(view).toContain(title)
    }
  })

  it("les laisse toutes fermées par défaut", () => {
    // `CollapsibleSection` est fermée sauf `defaultOpen`, qui n'apparaît nulle
    // part ici : le bloc ne doit jamais s'ouvrir de lui-même.
    expect(view).not.toContain("defaultOpen")
    expect(view.match(/<CollapsibleSection/g)).toHaveLength(5)
  })

  it("dit ce que le moteur fait vraiment de l'équité", () => {
    // La case agit désormais : les deux moteurs départagent sur la charge. Le
    // texte doit décrire cela, et surtout ne plus porter l'avertissement qui
    // disait le contraire.
    expect(view).not.toContain("le moteur ne l’optimise pas encore")
    expect(view).toContain("le moins chargé")
    expect(view).toContain("occasions réelles de fermer")
  })

  it("garde l'affectation aux postes hors de ce bloc", () => {
    for (const outOfScope of ["Coffre", "Caisse", "poste"]) {
      expect(view).not.toContain(outOfScope)
    }
  })

  it("n'ouvre aucune porte à un jour facultatif", () => {
    for (const shape of ["optionalDay", "jourFacultatif", "preferredDayOff", "flexibleDay"]) {
      expect(view).not.toContain(shape)
      expect(read("sector-demand.ts")).not.toContain(shape)
    }
  })
})

describe("secteur — le mode de génération reste hors périmètre", () => {
  it("n'introduit aucun réglage de bibliothèque de shifts", () => {
    // Auditée : la notion existe au niveau MAGASIN (`planningMode`), mais aucun
    // moteur V3 ne sait résoudre en mode bibliothèque. Un sélecteur de secteur
    // serait un réglage sans effet.
    const view = read("SectorAdvancedConstraints.tsx")
    expect(view).not.toContain("shift_library")
    expect(view).not.toContain("planningMode")
    expect(read("sector-demand.ts")).not.toContain("planningMode")
  })
})

describe("secteur — les valeurs par défaut sont énoncées une fois", () => {
  it("aligne un secteur neuf sur les règles en vigueur", () => {
    const rules = createEmptySector("neuf").shiftRules
    expect(rules.maximumDailyDuration).toBe(SECTOR_RULE_DEFAULTS.maximumDailyDuration)
    expect(rules.maximumContinuousDuration).toBe(SECTOR_RULE_DEFAULTS.maximumContinuousDuration)
    expect(rules.minimumSplitDuration).toBe(SECTOR_RULE_DEFAULTS.minimumSplitDuration)
    expect(rules.maximumSplitDuration).toBe(SECTOR_RULE_DEFAULTS.maximumSplitDuration)
    expect(rules.maximumSplitsPerDay).toBe(SECTOR_RULE_DEFAULTS.maximumSplitsPerDay)
    expect(rules.minimumRestMinutes).toBe(SECTOR_RULE_DEFAULTS.minimumRestMinutes)
  })

  it("correspond aux valeurs annoncées : 4 h / 8 h / 10 h, coupure 45–90, une par jour, repos 12 h", () => {
    expect(SECTOR_RULE_DEFAULTS.maximumContinuousDuration).toBe(8 * 60)
    expect(SECTOR_RULE_DEFAULTS.maximumDailyDuration).toBe(10 * 60)
    expect(SECTOR_RULE_DEFAULTS.minimumSplitDuration).toBe(45)
    expect(SECTOR_RULE_DEFAULTS.maximumSplitDuration).toBe(90)
    expect(SECTOR_RULE_DEFAULTS.maximumSplitsPerDay).toBe(1)
    expect(SECTOR_RULE_DEFAULTS.minimumRestMinutes).toBe(12 * 60)
    expect(SECTOR_RULE_DEFAULTS.lookbackWeeks).toBe(8)
  })
})
