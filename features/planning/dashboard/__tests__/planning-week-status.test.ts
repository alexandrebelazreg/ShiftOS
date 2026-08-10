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
