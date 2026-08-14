import { describe, expect, it } from "vitest"

import type { HolidayPlanEntry } from "@/features/core/models"
import {
  holidayImpact,
  holidayPlanForPeriod,
  weeklyTargetAfterHolidays,
  type HolidayImpactInput,
} from "@/features/planning/holidays/model/holiday-plan"

const usual = () => ({ opensAt: "08:30", closesAt: "20:00" })

const entry = (patch: Partial<HolidayPlanEntry> = {}): HolidayPlanEntry => ({
  date: "2026-07-14",
  opening: "travaille",
  volunteerIds: [],
  opensAtMinutes: 510,
  closesAtMinutes: 1200,
  ...patch,
})

const impact = (patch: Partial<HolidayImpactInput> = {}) =>
  holidayImpact({
    entry: entry(),
    employeeId: "luca",
    profile: { scheduleType: "variable" },
    contractMinutes: 2100,
    sunday: false,
    storeOpensSundays: false,
    usuallyWorksSundays: false,
    usualRestDay: false,
    ...patch,
  })

describe("ce qu’un férié retire à la semaine", () => {
  it("retire un cinquième à un horaire variable qui ne vient pas", () => {
    expect(impact()).toMatchObject({
      codes: ["JF"],
      contractReduction: "one-fifth",
      reducedMinutes: 420,
    })
  })

  it("ne retire rien à un volontaire retenu", () => {
    expect(impact({ entry: entry({ volunteerIds: ["luca"] }) })).toMatchObject({
      codes: [],
      reducedMinutes: 0,
    })
  })

  it("retire aussi une journée à un horaire fixe — mais en heures fériées", () => {
    // LE POINT À NE PAS CONFONDRE : le moteur soustrait la même quantité, sinon
    // il tasserait un contrat entier sur six jours. Ce qui diffère est le CODE :
    // « JF » dit une base diminuée, « HF » dit des heures dues et payées.
    const fixed = impact({ profile: { scheduleType: "fixed" } })

    expect(fixed).toMatchObject({
      codes: ["HF"],
      reducedMinutes: 420,
      keepUsualShiftsAsHolidayHours: true,
      // La base contractuelle, elle, n'est PAS diminuée.
      contractReduction: "none",
    })
  })

  it("traite un étudiant comme un horaire fixe, quelle que soit sa fiche", () => {
    expect(impact({ profile: { scheduleType: "variable", student: true } })).toMatchObject({
      codes: ["HF"],
      keepUsualShiftsAsHolidayHours: true,
    })
  })

  it("ne retire rien à un cadre au forfait jour, qui ne compte pas d’heures", () => {
    expect(impact({ profile: { forfaitJour: true } })).toMatchObject({
      codes: ["JF"],
      reducedMinutes: 0,
      keepUsualShiftsAsHolidayHours: false,
    })
  })

  it("suit le second tableau un dimanche férié", () => {
    const sunday = impact({
      sunday: true,
      storeOpensSundays: true,
      usuallyWorksSundays: true,
      entry: entry({ volunteerIds: ["luca"] }),
    })

    expect(sunday).toMatchObject({ codes: ["DF"], reducedMinutes: 210 })
  })
})

describe("l’objectif de la semaine", () => {
  it("cumule les fériés de la semaine", () => {
    const target = weeklyTargetAfterHolidays(2100, [impact(), impact({ entry: entry({ date: "2026-07-15" }) })])
    expect(target).toBe(2100 - 420 - 420)
  })

  it("ne descend jamais sous zéro", () => {
    // Une semaine entièrement fériée laisse zéro à placer, pas une dette que le
    // moteur essaierait de combler ailleurs.
    const week = Array.from({ length: 7 }, () => impact())
    expect(weeklyTargetAfterHolidays(2100, week)).toBe(0)
  })

  it("laisse le contrat entier quand la semaine n’a aucun férié", () => {
    expect(weeklyTargetAfterHolidays(2100, [])).toBe(2100)
  })
})

describe("les fériés d’une période", () => {
  it("ne retient que ceux qui tombent dans la semaine", () => {
    const plan = holidayPlanForPeriod({ start: "2026-07-13", end: "2026-07-19" }, {}, usual)

    expect(plan.map((entry) => entry.date)).toEqual(["2026-07-14"])
  })

  it("rend une liste vide sur une semaine sans férié", () => {
    // Et c'est ce qui garantit que le moteur ne voit rien de nouveau : sans
    // entrée, il retombe sur son ancien chemin.
    expect(holidayPlanForPeriod({ start: "2026-07-20", end: "2026-07-26" }, {}, usual)).toEqual([])
  })

  it("couvre les deux années d’une semaine à cheval sur janvier", () => {
    const plan = holidayPlanForPeriod({ start: "2025-12-29", end: "2026-01-04" }, {}, usual)

    expect(plan.map((entry) => entry.date)).toEqual(["2026-01-01"])
  })

  it("porte le réglage du magasin et ses volontaires", () => {
    const plan = holidayPlanForPeriod(
      { start: "2026-07-13", end: "2026-07-19" },
      { "2026-07-14": { opening: "demi-chome", opensAt: "08:00", closesAt: "12:30", volunteerIds: ["luca"] } },
      usual
    )

    expect(plan[0]).toEqual({
      date: "2026-07-14",
      opening: "demi-chome",
      volunteerIds: ["luca"],
      opensAtMinutes: 480,
      closesAtMinutes: 750,
    })
  })

  it("n’attribue aucun horaire à un férié chômé", () => {
    const plan = holidayPlanForPeriod(
      { start: "2025-12-22", end: "2025-12-28" },
      {},
      usual
    )

    // Noël est chômé par défaut.
    expect(plan[0]).toMatchObject({
      date: "2025-12-25",
      opening: "chome",
      opensAtMinutes: null,
      closesAtMinutes: null,
    })
  })
})
