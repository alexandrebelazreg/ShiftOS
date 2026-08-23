import { describe, expect, it } from "vitest"

import { createHolidayRepository } from "@/features/planning/holidays/holiday.repository"
import {
  buildHolidayYear,
  resolveSchedules,
  type HolidayEmployeeInput,
} from "@/features/planning/holidays/model/holiday-year-view-model"

const usual = () => ({ opensAt: "08:30", closesAt: "20:00" })

const roster: readonly HolidayEmployeeInput[] = [
  { id: "e1", name: "Luca Martin", scheduleType: "variable", active: true },
  { id: "e2", name: "Nora Petit", scheduleType: "fixed", active: true },
  { id: "e3", name: "Sami Roche", scheduleType: "variable", student: true, active: true },
  { id: "e4", name: "Elsa Nguyen", scheduleType: "variable", forfaitJour: true, active: true },
  { id: "e5", name: "Parti Ancien", scheduleType: "variable", active: false },
]

const year = (patch: Partial<Parameters<typeof buildHolidayYear>[0]> = {}) =>
  buildHolidayYear({ year: 2026, stored: {}, employees: roster, usualHours: usual, ...patch })

describe("l’année des jours fériés", () => {
  it("rend les onze fériés, avec leur jour de la semaine écrit", () => {
    const vm = year()

    expect(vm.days).toHaveLength(11)
    expect(vm.days[0]).toMatchObject({
      name: "Jour de l’An",
      date: "2026-01-01",
      dateLabel: "Jeudi 1 janvier",
    })
  })

  it("propose cinq années, à partir de la précédente", () => {
    expect(year().years).toEqual([2025, 2026, 2027, 2028, 2029])
  })

  it("n’ouvre pas la liste des volontaires sur un jour chômé", () => {
    const noel = year().days.find((day) => day.name === "Noël")

    expect(noel).toMatchObject({
      opening: "chome",
      acceptsVolunteers: false,
      volunteers: [],
      volunteerCountLabel: "—",
      openingLabel: "Magasin fermé",
    })
  })

  it("propose l’équipe active sur un férié ouvert, et elle seule", () => {
    const paques = year().days.find((day) => day.name === "Lundi de Pâques")

    expect(paques?.acceptsVolunteers).toBe(true)
    // « Parti Ancien » est inactif : le proposer reviendrait à recruter
    // quelqu'un qui n'est plus là.
    expect(paques?.volunteers.map((volunteer) => volunteer.name)).toEqual([
      "Luca MARTIN",
      "Nora PETIT",
      "Sami ROCHE",
      "Elsa NGUYEN",
    ])
  })

  it("dit le type d’horaire RÉELLEMENT appliqué, statut étudiant compris", () => {
    const paques = year().days.find((day) => day.name === "Lundi de Pâques")
    const labels = new Map(
      paques?.volunteers.map((volunteer) => [volunteer.name, volunteer.scheduleLabel])
    )

    expect(labels.get("Luca MARTIN")).toBe("Horaires variables")
    expect(labels.get("Nora PETIT")).toBe("Horaires fixes")
    // Sa fiche dit variable ; son statut d'étudiant décide, et l'écran le dit.
    expect(labels.get("Sami ROCHE")).toBe("Horaires fixes (étudiant)")
    expect(labels.get("Elsa NGUYEN")).toBe("Forfait jour")
  })

  it("compte les volontaires cochés", () => {
    const vm = year({ stored: { "2026-04-06": { volunteerIds: ["e1", "e2"] } } })
    const paques = vm.days.find((day) => day.date === "2026-04-06")

    expect(paques?.volunteerCountLabel).toBe("2 volontaires")
    expect(paques?.volunteers.filter((volunteer) => volunteer.volunteer)).toHaveLength(2)
  })

  it("ignore un volontaire devenu inactif dans le compte", () => {
    const vm = year({ stored: { "2026-04-06": { volunteerIds: ["e1", "e5"] } } })
    const paques = vm.days.find((day) => day.date === "2026-04-06")

    expect(paques?.volunteerCountLabel).toBe("1 volontaire")
  })

  it("signale un dimanche férié et le propose travaillé", () => {
    // Le 1er novembre 2026 tombe un dimanche.
    const toussaint = year().days.find((day) => day.date === "2026-11-01")

    expect(toussaint).toMatchObject({ sunday: true, opening: "travaille" })
  })
})

describe("le calendrier réglé", () => {
  it("n’écrase que ce que le gérant a explicitement changé", () => {
    const schedules = resolveSchedules(2026, { "2026-04-06": { opening: "demi-chome" } }, usual)
    const paques = schedules.find((entry) => entry.date === "2026-04-06")
    const ascension = schedules.find((entry) => entry.key === "ascension")

    expect(paques?.opening).toBe("demi-chome")
    // Les horaires non touchés restent ceux proposés.
    expect(paques).toMatchObject({ opensAt: "08:30", closesAt: "20:00" })
    expect(ascension?.opening).toBe("travaille")
  })

  it("retire ses horaires à un jour repassé en chômé", () => {
    // Sinon une plage réapparaîtrait le jour où il redeviendrait travaillé,
    // sans que personne l'ait décidé.
    const schedules = resolveSchedules(
      2026,
      { "2026-04-06": { opening: "chome", opensAt: "08:30", closesAt: "20:00" } },
      usual
    )

    expect(schedules.find((entry) => entry.date === "2026-04-06")).toMatchObject({
      opening: "chome",
      opensAt: null,
      closesAt: null,
    })
  })
})

describe("le dépôt des jours fériés", () => {
  const memory = () => {
    const map = new Map<string, string>()
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
    }
  }

  it("relit ce qu’il a écrit", async () => {
    const storage = memory()
    const repository = createHolidayRepository(storage)
    await repository.save({ "2026-04-06": { opening: "chome", volunteerIds: ["e1"] } })

    expect(await createHolidayRepository(storage).read()).toEqual({
      "2026-04-06": { opening: "chome", volunteerIds: ["e1"] },
    })
  })

  it("traite un stockage illisible comme un stockage vide", async () => {
    // Le calendrier repart de ses valeurs par défaut plutôt que de faire
    // tomber l'écran.
    const storage = { getItem: () => "{ pas du json", setItem: () => {} }
    expect(await createHolidayRepository(storage).read()).toEqual({})
  })

  it("écarte une entrée mal formée sans perdre les autres", async () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          "2026-04-06": { opening: "chome" },
          "2026-05-01": "n’importe quoi",
          "2026-05-14": { opening: "inconnu", volunteerIds: ["e1", 42] },
        }),
      setItem: () => {},
    }

    const read = await createHolidayRepository(storage).read()
    expect(read["2026-04-06"]).toEqual({ opening: "chome", volunteerIds: [] })
    expect(read["2026-05-01"]).toBeUndefined()
    // Un statut inconnu retombe sur la proposition par défaut ; les volontaires
    // valides survivent.
    expect(read["2026-05-14"]).toEqual({ volunteerIds: ["e1"] })
  })
})
