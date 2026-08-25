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

  it("distinguishes saved and published weeks", () => {
    const weeks = buildPlanningWeekStatuses("2026-08-03", [
      planning(),
      planning({
        id: "planning-2",
        status: "published",
        periodStart: "2026-08-10",
        periodEnd: "2026-08-16",
      }),
    ])

    expect(weeks[0]).toMatchObject({ state: "saved", planningId: "planning-1" })
    expect(weeks[1]).toMatchObject({ state: "published", planningId: "planning-2" })
    expect(weeks[2].state).toBe("untreated")
  })

  it("shows the most recently updated record when a week has several versions", () => {
    const weeks = buildPlanningWeekStatuses("2026-08-03", [
      planning({ id: "published", status: "published" }),
      planning({ id: "new-draft", updatedAt: "2026-08-03T09:00:00.000Z" }),
    ])

    expect(weeks[0]).toMatchObject({ state: "saved", planningId: "new-draft" })
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

  it("ne passe au vert que lorsque TOUS les rayons sont publiés", () => {
    const complete = SECTORS.map((sector) =>
      planning({ id: sector.id, status: "published", sectorIds: [sector.id] })
    )
    expect(first(buildPlanningWeekStatuses("2026-08-03", complete, SECTORS)).state).toBe("published")
  })

  it("passe au jaune dès le premier rayon publié, et nomme les manquants", () => {
    const week = first(
      buildPlanningWeekStatuses(
        "2026-08-03",
        [planning({ id: "drive", status: "published", sectorIds: ["drive"] })],
        SECTORS
      )
    )
    expect(week.state).toBe("partial")
    expect(week.publishedSectors).toEqual(["Drive"])
    // Nommés, parce que « partiel » seul obligerait à ouvrir la semaine pour
    // découvrir lequel manque.
    expect(week.missingSectors).toEqual(["Caisse", "Fruits"])
  })

  it("reste « enregistré » tant qu'aucun rayon n'est publié", () => {
    const week = first(
      buildPlanningWeekStatuses(
        "2026-08-03",
        [planning({ id: "drive", sectorIds: ["drive"] })],
        SECTORS
      )
    )
    expect(week.state).toBe("saved")
    expect(week.publishedSectors).toEqual([])
  })

  it("retire un rayon rouvert en brouillon, même si sa publication existe encore", () => {
    // Rouvrir une semaine publiée crée un brouillon plus récent sans toucher à
    // l'original. Compter la publication qui subsiste ferait passer pour
    // terminé un rayon que quelqu'un est en train de refaire.
    const week = first(
      buildPlanningWeekStatuses(
        "2026-08-03",
        [
          ...SECTORS.map((sector) =>
            planning({ id: sector.id, status: "published", sectorIds: [sector.id] })
          ),
          planning({
            id: "drive-repris",
            sectorIds: ["drive"],
            updatedAt: "2026-08-04T08:00:00.000Z",
          }),
        ],
        SECTORS
      )
    )
    expect(week.state).toBe("partial")
    expect(week.missingSectors).toEqual(["Drive"])
  })

  it("ignore les rayons archivés, qui ne sont pas « à publier »", () => {
    // L'appelant ne transmet que les rayons actifs ; sans cette règle, un rayon
    // fermé garderait indéfiniment les semaines en jaune.
    const week = first(
      buildPlanningWeekStatuses(
        "2026-08-03",
        [planning({ id: "drive", status: "published", sectorIds: ["drive"] })],
        [{ id: "drive", name: "Drive" }]
      )
    )
    expect(week.state).toBe("published")
  })
})
