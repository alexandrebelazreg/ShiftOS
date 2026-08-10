import { describe, expect, it } from "vitest"

import { calculatePaidLeaveCoverage } from "@/features/paid-leave/coverage/paid-leave-coverage"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

const sector = (id: string, name: string) => ({ id, name, status: "active" }) as SectorDemandConfiguration
const employee = (id: string, name: string, hours: number) => ({
  id,
  firstName: id,
  lastName: "Test",
  status: "active",
  sectors: [name],
  weeklyHours: hours,
}) as EmployeeRecord

function campaign(): PaidLeaveCampaign {
  return {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 20 },
    status: "editing",
    employeeSettings: {},
    requests: {},
    coverage: {
      caisse: { "2026-W20": { minimumHours: 60, toleratedDeficitHours: 5 } },
      drive: { "2026-W20": { minimumHours: 30, toleratedDeficitHours: 0 } },
    },
    reinforcementPools: [],
    grants: { alice: ["2026-W20"] },
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

describe("couverture des congés payés", () => {
  it("retire le contrat du secteur principal pendant une semaine accordée", () => {
    const summary = calculatePaidLeaveCoverage({
      campaign: campaign(),
      sectors: [sector("caisse", "Caisse"), sector("drive", "Drive")],
      employees: [employee("alice", "Caisse", 35), employee("bruno", "Caisse", 35), employee("clara", "Drive", 35)],
    })
    expect(summary.cells.find((cell) => cell.sectorId === "caisse")).toMatchObject({
      baseContractHours: 70,
      absentHours: 35,
      presentHours: 35,
      state: "red",
    })
  })

  it("distribue librement une réserve globale sans dépasser son total", () => {
    const withPool: PaidLeaveCampaign = {
      ...campaign(),
      reinforcementPools: [{
        id: "summer-help",
        label: "Renfort été",
        totalHours: 30,
        startWeekId: "2026-W20",
        endWeekId: "2026-W20",
        scope: "global",
        sectorId: null,
      }],
    }
    const summary = calculatePaidLeaveCoverage({
      campaign: withPool,
      sectors: [sector("caisse", "Caisse"), sector("drive", "Drive")],
      employees: [employee("alice", "Caisse", 35), employee("bruno", "Caisse", 35), employee("clara", "Drive", 35)],
    })
    expect(summary.pools[0]).toMatchObject({ usedHours: 25, remainingHours: 5 })
    expect(summary.cells.find((cell) => cell.sectorId === "caisse")).toMatchObject({
      reinforcementHours: 25,
      totalHours: 60,
      state: "green",
    })
  })
})
