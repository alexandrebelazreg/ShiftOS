import { describe, expect, it } from "vitest"

import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import { createPaidLeaveRepository } from "@/features/paid-leave/persistence/paid-leave-repository"

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

function campaign(id: string): PaidLeaveCampaign {
  return {
    schemaVersion: 1,
    id,
    name: "Été 2026",
    year: 2026,
    period: { kind: "summer", startWeek: 18, endWeek: 43 },
    status: "editing",
    employeeSettings: {},
    requests: {},
    coverage: {},
    reinforcementPools: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("persistance des campagnes de congés", () => {
  it("enregistre chaque campagne séparément et mémorise la campagne active", async () => {
    const repository = createPaidLeaveRepository(memoryStorage())
    await repository.save(campaign("summer"))
    await repository.save({ ...campaign("winter"), name: "Hiver 2026–2027" })
    await repository.setActiveId("winter")

    expect((await repository.list()).map((item) => item.id)).toEqual(["winter", "summer"])
    expect((await repository.get("summer"))?.name).toBe("Été 2026")
    expect(await repository.activeId()).toBe("winter")
  })
})
