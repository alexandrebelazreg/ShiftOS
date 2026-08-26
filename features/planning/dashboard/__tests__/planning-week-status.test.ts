import { describe, expect, it } from "vitest"

import type { PlanningSummary } from "@/features/planning/persistence"
import {
  buildPlanningWeekStatuses,
  isoDateInTimeZone,
} from "@/features/planning/dashboard/planning-week-status"

function planning(overrides: Partial<PlanningSummary> = {}): PlanningSummary {
  return {
    id: "planning-1",
    status: "draft",
    label: "Planning test",
    periodStart: "2026-08-03",
    periodEnd: "2026-08-09",
    updatedAt: "2026-08-03T08:00:00.000Z",
    ...overrides,
  }
}

describe("dashboard planning horizon", () => {
  it("uses the store timezone to determine the current week", () => {
    const nearMidnight = new Date("2026-08-03T22:30:00.000Z")

    expect(isoDateInTimeZone(nearMidnight, "Europe/Paris")).toBe("2026-08-04")
    expect(isoDateInTimeZone(nearMidnight, "America/Montreal")).toBe("2026-08-03")
  })

  it("covers the current week through S+6", () => {
    const weeks = buildPlanningWeekStatuses("2026-08-03", [])

    expect(weeks).toHaveLength(7)
    expect(weeks[0]).toMatchObject({
      weekStart: "2026-08-03",
      weekNumber: 32,
      offsetLabel: "Cette semaine",
      state: "untreated",
    })
    expect(weeks[6]).toMatchObject({
      weekStart: "2026-09-14",
      offsetLabel: "S+6",
      state: "untreated",
    })
  })

  /**
   * Le statut d'un enregistrement ne colore plus rien.
   *
   * `draft`, `published` et `archived` cohabitent en base — les deux derniers
   * datent d'avant la disparition du bouton Publier — et se lisent désormais
   * tous comme « enregistré ». Aucune ligne n'a été réécrite pour cela, et le
   * tableau de bord ne doit pas trahir la différence.
   */
  it("lit un ancien planning publié comme un planning enregistré", () => {
    const weeks = buildPlanningWeekStatuses("2026-08-03", [
      planning(),
      planning({
        id: "planning-2",
        status: "published",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
      }),
    ])

    expect(weeks[0]).toMatchObject({ state: "posted", planningId: "planning-1" })
    expect(weeks[1]).toMatchObject({ state: "posted", planningId: "planning-2" })
    expect(weeks[2].state).toBe("untreated")
  })

  it("shows the most recently updated record when a week has several versions", () => {
    const weeks = buildPlanningWeekStatuses("2026-08-03", [
      planning({ id: "published", status: "published" }),
      planning({ id: "new-draft", updatedAt: "2026-08-03T09:00:00.000Z" }),
    ])

    expect(weeks[0]).toMatchObject({ state: "posted", planningId: "new-draft" })
  })
})

/**
 * La couleur d'une semaine, quand le magasin a plusieurs rayons.
 *
 * Une semaine se planifie RAYON PAR RAYON. Le tableau lisait le seul planning
 * le plus récent : publier le Drive peignait la semaine en vert alors que cinq
 * rayons restaient à faire — le contraire de ce qu'un coup d'œil doit
 * apprendre, et d'autant plus trompeur que le vert invite à passer à la suite.
 */
describe("complétude par rayon", () => {
  const SECTORS = [
    { id: "drive", name: "Drive" },
    { id: "caisse", name: "Caisse" },
    { id: "fruits", name: "Fruits" },
  ]
  const first = (weeks: ReturnType<typeof buildPlanningWeekStatuses>) => weeks[0]

  it("ne passe au vert que lorsque TOUS les rayons sont enregistrés", () => {
    const complete = SECTORS.map((sector) => planning({ id: sector.id, sectorIds: [sector.id] }))
    expect(first(buildPlanningWeekStatuses("2026-08-03", complete, SECTORS)).state).toBe("posted")
  })

  it("passe au jaune dès le premier rayon enregistré, et nomme les manquants", () => {
    const week = first(
      buildPlanningWeekStatuses(
        "2026-08-03",
        [planning({ id: "drive", sectorIds: ["drive"] })],
        SECTORS
      )
    )
    expect(week.state).toBe("partial")
    expect(week.postedSectors).toEqual(["Drive"])
    // Nommés, parce que « partiel » seul obligerait à ouvrir la semaine pour
    // découvrir lequel manque.
    expect(week.missingSectors).toEqual(["Caisse", "Fruits"])
  })

  /**
   * Un enregistrement qui ne nomme aucun rayon ne fait avancer personne.
   *
   * Il ne peut être attribué à rien — deviner ferait passer pour terminé un
   * rayon auquel personne n'a touché — et la semaine reste donc « non traitée »
   * bien qu'un planning existe. Le lien vers elle, lui, pointe dessus.
   */
  it("ne crédite aucun rayon à un enregistrement qui n'en nomme aucun", () => {
    const week = first(
      buildPlanningWeekStatuses("2026-08-03", [planning({ id: "sans-rayon" })], SECTORS)
    )
    expect(week.state).toBe("untreated")
    expect(week.postedSectors).toEqual([])
    expect(week.planningId).toBe("sans-rayon")
  })

  /**
   * Rouvrir ne défait plus rien.
   *
   * Le tableau ne lisait que le planning le PLUS RÉCENT de chaque rayon : un
   * brouillon rouvert par-dessus une publication faisait repasser le rayon pour
   * inachevé. Ce raisonnement supposait deux gestes ; il n'y en a plus qu'un, et
   * un rayon déjà enregistré le reste — le régénérer ne le rend pas moins fait.
   */
  it("garde un rayon acquis quand un enregistrement plus récent s'y ajoute", () => {
    const week = first(
      buildPlanningWeekStatuses(
        "2026-08-03",
        [
          ...SECTORS.map((sector) => planning({ id: sector.id, sectorIds: [sector.id] })),
          planning({
            id: "drive-repris",
            sectorIds: ["drive"],
            updatedAt: "2026-08-04T08:00:00.000Z",
          }),
        ],
        SECTORS
      )
    )
    expect(week.state).toBe("posted")
    expect(week.missingSectors).toEqual([])
  })

  it("ignore les rayons archivés, qui ne sont plus à traiter", () => {
    // L'appelant ne transmet que les rayons actifs ; sans cette règle, un rayon
    // fermé garderait indéfiniment les semaines en jaune.
    const week = first(
      buildPlanningWeekStatuses(
        "2026-08-03",
        [planning({ id: "drive", sectorIds: ["drive"] })],
        [{ id: "drive", name: "Drive" }]
      )
    )
    expect(week.state).toBe("posted")
  })
})
