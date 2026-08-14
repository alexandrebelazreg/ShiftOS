import { describe, expect, it } from "vitest"

import {
  holidayTreatment,
  reducedMinutes,
  type HolidayCase,
} from "@/features/planning/holidays/model/holiday-treatment"

/**
 * Un test par ligne des trois tableaux de l'enseigne.
 *
 * Ce fichier EST la documentation RH. Si l'enseigne corrige un cas, c'est ici
 * que la correction se voit d'abord, et le test qui tombe dit laquelle des
 * lignes a changé. Les libellés de `describe` reprennent volontairement les
 * intitulés des captures, pour qu'on puisse relire les deux côte à côte.
 */

const base: HolidayCase = {
  opening: "travaille",
  scheduleType: "variable",
  forfaitJour: false,
  sunday: false,
  storeOpensSundays: false,
  usuallyWorksSundays: false,
  usualRestDay: false,
  presence: "none",
}

const on = (patch: Partial<HolidayCase>) => holidayTreatment({ ...base, ...patch })

describe("1er cas — le magasin est fermé (jour chômé)", () => {
  it("horaires variables : planning impacté d’un cinquième", () => {
    expect(on({ opening: "chome", scheduleType: "variable" })).toMatchObject({
      codes: ["JF"],
      contractReduction: "one-fifth",
    })
  })

  it("horaires fixes : heures fériées à la place des plages", () => {
    expect(on({ opening: "chome", scheduleType: "fixed" })).toMatchObject({
      codes: ["HF"],
      contractReduction: "none",
      keepUsualShiftsAsHolidayHours: true,
      halfRestToPlace: true,
    })
  })

  it("horaires fixes en repos habituel : on laisse le RH", () => {
    expect(on({ opening: "chome", scheduleType: "fixed", usualRestDay: true })).toMatchObject({
      codes: ["RH"],
      keepUsualShiftsAsHolidayHours: false,
    })
  })
})

describe("1er cas — le magasin est ouvert le matin (½ jour chômé)", () => {
  it("travaille, horaires variables : base diminuée d’un dixième", () => {
    expect(on({ opening: "demi-chome", scheduleType: "variable", presence: "full" })).toMatchObject({
      codes: ["DF"],
      contractReduction: "one-tenth",
    })
  })

  it("travaille, horaires fixes : heures fériées sur l’après-midi", () => {
    expect(on({ opening: "demi-chome", scheduleType: "fixed", presence: "full" })).toMatchObject({
      codes: ["HF"],
      contractReduction: "none",
      halfRestToPlace: true,
    })
  })

  it("ne travaille pas, horaires variables : les deux demies font un jour entier", () => {
    // « Base diminuée d'1/10ème ET d'un autre après-midi → transformation en JF
    // avec impact 1/5ème. » C'est l'impact NET qui compte pour l'objectif.
    expect(on({ opening: "demi-chome", scheduleType: "variable" })).toMatchObject({
      codes: ["JF"],
      contractReduction: "one-fifth",
    })
  })

  it("ne travaille pas, horaires fixes : heures fériées sur la journée", () => {
    expect(on({ opening: "demi-chome", scheduleType: "fixed" })).toMatchObject({
      codes: ["HF"],
      keepUsualShiftsAsHolidayHours: true,
    })
  })

  it("ne travaille pas, horaires fixes en repos habituel : RH", () => {
    expect(on({ opening: "demi-chome", scheduleType: "fixed", usualRestDay: true })).toMatchObject({
      codes: ["RH"],
    })
  })
})

describe("1er cas — le magasin est ouvert la journée (jour travaillé)", () => {
  it("ne travaille pas, horaires variables : jour férié, impact d’un cinquième", () => {
    expect(on({ scheduleType: "variable" })).toMatchObject({
      codes: ["JF"],
      contractReduction: "one-fifth",
    })
  })

  it("ne travaille pas, horaires fixes : plages converties en heures fériées", () => {
    expect(on({ scheduleType: "fixed" })).toMatchObject({
      codes: ["HF"],
      keepUsualShiftsAsHolidayHours: true,
      halfRestToPlace: true,
    })
  })

  it("ne travaille pas, horaires fixes, repos habituel ce jour : RH", () => {
    expect(on({ scheduleType: "fixed", usualRestDay: true })).toMatchObject({ codes: ["RH"] })
  })

  it("travaille en demi-journée : plages sur une moitié, demi-repos sur l’autre", () => {
    for (const scheduleType of ["fixed", "variable"] as const) {
      expect(on({ scheduleType, presence: "half" })).toMatchObject({
        codes: ["DH"],
        contractReduction: "none",
        halfRestToPlace: true,
      })
    }
  })

  it("travaille : planification, et rien à retirer au contrat", () => {
    for (const scheduleType of ["fixed", "variable"] as const) {
      expect(on({ scheduleType, presence: "full" })).toMatchObject({
        codes: [],
        contractReduction: "none",
        keepUsualShiftsAsHolidayHours: false,
      })
    }
  })
})

describe("2ème cas — dimanches fériés, magasin habituellement ouvert", () => {
  const sunday = { sunday: true, storeOpensSundays: true } as const

  it("travaille, horaires variables : base diminuée d’un dixième", () => {
    expect(on({ ...sunday, scheduleType: "variable", presence: "full" })).toMatchObject({
      codes: ["DF"],
      contractReduction: "one-tenth",
    })
  })

  it("travaille, horaires fixes : planning habituel", () => {
    expect(on({ ...sunday, scheduleType: "fixed", presence: "full" })).toMatchObject({
      codes: [],
      contractReduction: "none",
    })
  })

  it("ne travaille pas mais travaille habituellement le dimanche : un dixième et un demi-repos", () => {
    expect(
      on({ ...sunday, scheduleType: "variable", usuallyWorksSundays: true })
    ).toMatchObject({
      codes: ["DF", "DH"],
      contractReduction: "one-tenth",
      halfRestToPlace: true,
    })
  })

  it("ne travaille jamais le dimanche : planning habituel avec un RH", () => {
    expect(on({ ...sunday, scheduleType: "variable" })).toMatchObject({
      codes: ["RH"],
      contractReduction: "none",
    })
  })

  it("horaires fixes absents qui viennent d’ordinaire : heures fériées et demi-repos", () => {
    expect(
      on({ ...sunday, scheduleType: "fixed", usuallyWorksSundays: true })
    ).toMatchObject({
      codes: ["HF", "DH"],
      keepUsualShiftsAsHolidayHours: true,
      halfRestToPlace: true,
    })
  })

  it("horaires fixes qui ne viennent jamais le dimanche : RH", () => {
    expect(on({ ...sunday, scheduleType: "fixed" })).toMatchObject({ codes: ["RH"] })
  })

  it("magasin fermé ce dimanche-là : RH pour tout le monde", () => {
    for (const scheduleType of ["fixed", "variable"] as const) {
      expect(on({ ...sunday, opening: "chome", scheduleType })).toMatchObject({ codes: ["RH"] })
    }
  })
})

describe("2ème cas — dimanches fériés, magasin habituellement fermé", () => {
  it("ne peut y avoir que du RH, quels que soient l’horaire et la présence", () => {
    for (const scheduleType of ["fixed", "variable"] as const) {
      for (const presence of ["none", "half", "full"] as const) {
        expect(
          on({ sunday: true, storeOpensSundays: false, scheduleType, presence })
        ).toMatchObject({ codes: ["RH"] })
      }
    }
  })
})

describe("cadres au forfait jour", () => {
  it("présents : présence jour", () => {
    expect(on({ forfaitJour: true, presence: "full" })).toMatchObject({ codes: ["PJ"] })
  })

  it("absents : jour férié, jamais des heures fériées", () => {
    expect(on({ forfaitJour: true })).toMatchObject({
      codes: ["JF"],
      keepUsualShiftsAsHolidayHours: false,
    })
  })

  it("un dimanche férié à magasin fermé : RH ou PJ, rien d’autre", () => {
    expect(on({ forfaitJour: true, sunday: true, opening: "chome" })).toMatchObject({
      codes: ["RH"],
    })
    expect(
      on({ forfaitJour: true, sunday: true, opening: "chome", presence: "full" })
    ).toMatchObject({ codes: ["PJ"] })
  })

  it("ne se voit jamais retirer des heures : un forfait jour n’en compte pas", () => {
    for (const opening of ["chome", "demi-chome", "travaille"] as const) {
      expect(on({ forfaitJour: true, opening }).contractReduction).toBe("none")
    }
  })
})

describe("des heures fériées ne couvrent rien", () => {
  it("aucun traitement ne reporte des plages tout en laissant le salarié planifiable", () => {
    // Le garde-fou du moteur : quelqu'un dont les plages deviennent des HF n'est
    // pas au comptoir. Le compter présent ferait croire le rayon tenu.
    const cases: Partial<HolidayCase>[] = [
      { opening: "chome", scheduleType: "fixed" },
      { opening: "demi-chome", scheduleType: "fixed" },
      { scheduleType: "fixed" },
      { sunday: true, storeOpensSundays: true, scheduleType: "fixed", usuallyWorksSundays: true },
    ]
    for (const patch of cases) {
      const treatment = on(patch)
      expect(treatment.keepUsualShiftsAsHolidayHours).toBe(true)
      expect(treatment.codes).toContain("HF")
    }
  })
})

describe("la réduction en minutes", () => {
  it("retire un cinquième de la base hebdomadaire, jours travaillés ignorés", () => {
    // Arbitrage confirmé : un temps partiel sur quatre jours perd lui aussi un
    // cinquième de sa base, pas un quart.
    expect(reducedMinutes(2100, "one-fifth")).toBe(420) // 35h → 7h
    expect(reducedMinutes(1800, "one-fifth")).toBe(360) // 30h → 6h
    expect(reducedMinutes(2100, "one-tenth")).toBe(210) // 35h → 3h30
    expect(reducedMinutes(2100, "none")).toBe(0)
  })

  it("arrondit à la minute plutôt que de traîner des décimales", () => {
    expect(reducedMinutes(2190, "one-fifth")).toBe(438)
    expect(reducedMinutes(1387, "one-tenth")).toBe(139)
  })
})
