import { describe, expect, it } from "vitest"

import { calculatePaidLeaveCoverage, sectorContractHours } from "@/features/paid-leave/coverage/paid-leave-coverage"
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

describe("les heures de contrat de chaque rayon", () => {
  // Ce que la configuration propose comme minimum commun : cinq salariés à
  // 30 h qui ont le Drive en premier rayon font 150 h.
  const drive = sector("drive", "Drive")
  const caisse = sector("caisse", "Caisse")

  it("additionne les contrats des salariés dont c'est le premier rayon", () => {
    const team = ["a", "b", "c", "d", "e"].map((id) => employee(id, "Drive", 30))
    expect(sectorContractHours(team, [drive, caisse]).get("drive")).toBe(150)
    expect(sectorContractHours(team, [drive, caisse]).get("caisse")).toBe(0)
  })

  it("ne compte ni un second rayon, ni un salarié inactif", () => {
    const helper = { ...employee("f", "Caisse", 35), sectors: ["Caisse", "Drive"] } as EmployeeRecord
    const gone = { ...employee("g", "Drive", 30), status: "inactive" } as EmployeeRecord
    expect(sectorContractHours([employee("a", "Drive", 30), helper, gone], [drive, caisse]).get("drive")).toBe(30)
  })

  it("lit le contrat en minutes quand il est connu", () => {
    const precise = { ...employee("a", "Drive", 36.5), weeklyMinutes: 2_205 } as EmployeeRecord
    expect(sectorContractHours([precise], [drive]).get("drive")).toBe(36.75)
  })

  it("donne au tableau de couverture le même total", () => {
    const team = ["a", "b"].map((id) => employee(id, "Drive", 30))
    const summary = calculatePaidLeaveCoverage({ campaign: campaign(), sectors: [drive, caisse], employees: team })
    expect(summary.cells.find((cell) => cell.sectorId === "drive")?.baseContractHours).toBe(
      sectorContractHours(team, [drive, caisse]).get("drive")
    )
  })
})
