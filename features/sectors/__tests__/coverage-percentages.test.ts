import { describe, expect, it } from "vitest"

import {
  buildHourlyProfile,
  createEmptySector,
  createSectorRepository,
  coveragePercentages,
  releaseCoveragePercentages,
  withCoveragePercent,
  type CoverageSlot,
} from "@/features/sectors"

/**
 * The percentage column: the durable SHAPE of a day, as opposed to the
 * head-counts, which are that shape instantiated for one particular team.
 *
 * Two promises are being kept here, and the second is what makes the first
 * usable: the day always totals exactly 100, and only shares nobody has touched
 * are allowed to move.
 */

const slots = (...employees: number[]): CoverageSlot[] =>
  employees.map((count, index) => ({
    start: `${String(6 + index).padStart(2, "0")}:00`,
    end: `${String(7 + index).padStart(2, "0")}:00`,
    employees: count,
  }))

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

describe("pourcentages — dérivés des effectifs tant que personne n'a touché", () => {
  it("convertit les effectifs en parts qui totalisent exactement 100", () => {
    expect(coveragePercentages(slots(1, 1, 2))).toEqual([25, 25, 50])
  })

  it("retombe sur 100 même quand la division ne tombe pas juste", () => {
    // 1/3 chacun : 33,33 % ne peut pas s'écrire en entiers sans reste. Arrondir
    // chaque part isolément donnerait 99 ; le plus fort reste rattrape l'unité.
    const percentages = coveragePercentages(slots(1, 1, 1))
    expect(sum(percentages)).toBe(100)
    expect(percentages).toEqual([34, 33, 33])
  })

  it("reste déterministe sur les égalités", () => {
    expect(coveragePercentages(slots(1, 1, 1))).toEqual(coveragePercentages(slots(1, 1, 1)))
  })

  it("ne décrit aucune forme pour une journée sans besoin", () => {
    // Inventer un partage égal poserait une part sur des heures que le secteur
    // n'a jamais demandé à couvrir.
    expect(coveragePercentages(slots(0, 0, 0))).toEqual([0, 0, 0])
  })

  it("lit une journée enregistrée avant l'existence de la colonne", () => {
    // Aucune part stockée : les effectifs décrivent la journée, comme toujours.
    const legacy = buildHourlyProfile("06:00", "10:00", 2)
    expect(legacy.every((slot) => slot.percent === undefined)).toBe(true)
    expect(sum(coveragePercentages(legacy))).toBe(100)
  })
})

describe("pourcentages — une modification rééquilibre le reste", () => {
  it("garde le total à 100 après une saisie", () => {
    const next = withCoveragePercent(slots(1, 1, 2), "06:00", 50)
    expect(sum(coveragePercentages(next))).toBe(100)
    expect(next[0].percent).toBe(50)
  })

  it("ne redistribue que sur les parts non touchées", () => {
    // 25 / 25 / 50 au départ. On fixe la première à 50 : les 50 restants se
    // partagent entre les deux autres, au prorata de ce qu'elles valaient.
    const next = withCoveragePercent(slots(1, 1, 2), "06:00", 50)
    expect(coveragePercentages(next)).toEqual([50, 17, 33])
  })

  it("ne touche JAMAIS une part déjà saisie", () => {
    // Le cœur de la demande : corriger un second créneau ne doit pas défaire le
    // premier.
    const first = withCoveragePercent(slots(1, 1, 1, 1), "06:00", 40)
    const second = withCoveragePercent(first, "07:00", 30)
    expect(second[0].percent).toBe(40)
    expect(second[1].percent).toBe(30)
    expect(sum(coveragePercentages(second))).toBe(100)
    // Les deux dernières, jamais touchées, absorbent le reste.
    expect(second[2].percent! + second[3].percent!).toBe(30)
  })

  it("marque comme verrouillée la part que l'on vient de saisir, et elle seule", () => {
    const next = withCoveragePercent(slots(1, 1, 2), "07:00", 40)
    expect(next.map((slot) => slot.percentLocked ?? false)).toEqual([false, true, false])
  })

  it("plafonne une saisie que les parts verrouillées ne laissent pas passer", () => {
    // 70 verrouillés ailleurs : demander 60 ici est impossible, on donne 30.
    const locked = withCoveragePercent(slots(1, 1, 1), "06:00", 70)
    const next = withCoveragePercent(locked, "07:00", 60)
    expect(next[1].percent).toBe(30)
    expect(sum(coveragePercentages(next))).toBe(100)
  })

  it("accepte zéro comme une part choisie", () => {
    const next = withCoveragePercent(slots(2, 1, 1), "06:00", 0)
    expect(next[0].percent).toBe(0)
    expect(next[0].percentLocked).toBe(true)
    expect(sum(coveragePercentages(next))).toBe(100)
  })

  it("ignore un créneau inconnu plutôt que de casser la journée", () => {
    const original = slots(1, 1, 2)
    expect(withCoveragePercent(original, "23:00", 50)).toEqual(original)
  })

  it("rend la main aux effectifs quand on relâche les parts", () => {
    const locked = withCoveragePercent(slots(1, 1, 2), "06:00", 90)
    const released = releaseCoveragePercentages(locked)
    expect(released.every((slot) => slot.percent === undefined)).toBe(true)
    expect(coveragePercentages(released)).toEqual([25, 25, 50])
  })
})

describe("pourcentages — ils survivent à l'enregistrement", () => {
  it("persiste la part et son verrouillage", async () => {
    // Sans cela la forme de la journée serait perdue au rechargement, et le
    // chiffre existerait le temps d'une session — donc ne servirait à rien pour
    // absorber une absence la semaine suivante.
    const base = createEmptySector("sector_1")
    const monday = withCoveragePercent(buildHourlyProfile("06:00", "10:00", 2), "06:00", 70)
    const sector = {
      ...base,
      name: "Drive",
      hours: base.hours.map((day) => (day.day === "monday" ? { ...day, closed: false, opensAt: "06:00", closesAt: "10:00" } : day)),
      coverage: { standardDay: "monday" as const, profiles: { monday } },
    }

    let stored: string | null = null
    const repository = createSectorRepository({
      getItem: () => stored,
      setItem: (_key, next) => { stored = next },
    })
    await repository.save([sector])

    const reloaded = (await repository.list())[0].coverage.profiles.monday!
    expect(reloaded[0].percent).toBe(70)
    expect(reloaded[0].percentLocked).toBe(true)
    expect(coveragePercentages(reloaded).reduce((total, value) => total + value, 0)).toBe(100)
  })
})
