import { expect, it } from "vitest"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import { buildPaidLeaveSolveRequest } from "@/features/paid-leave/solver/paid-leave-solver-contract"
import type { SectorDemandConfiguration } from "@/features/sectors"

it("construit un problème avec le meilleur rang de chaque semaine", () => {
  const campaign = {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 21 },
    status: "editing",
    employeeSettings: { alice: { employeeId: "alice", priority: false, linkedEmployeeId: null, entryDate: "2020-01-01", firstChoiceHistory: 2 } },
    requests: { alice: { employeeId: "alice", requestedWeeks: 1, wish1: ["2026-W20"], wish2: ["2026-W20", "2026-W21"], wish3: [] } },
    coverage: { caisse: { "2026-W20": { minimumHours: 0, toleratedDeficitHours: 0 }, "2026-W21": { minimumHours: 0, toleratedDeficitHours: 0 } } },
    reinforcementPools: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as PaidLeaveCampaign
  const employees = [{ id: "alice", firstName: "Alice", lastName: "Test", status: "active", sectors: ["Caisse"], weeklyHours: 35, createdAt: "2020-01-01T00:00:00.000Z" }] as EmployeeRecord[]
  const sectors = [{ id: "caisse", name: "Caisse", status: "active" }] as SectorDemandConfiguration[]

  const request = buildPaidLeaveSolveRequest({ campaign, employees, sectors })
  expect(request.employees[0]).toMatchObject({ targetWeeks: 1, sectorId: "caisse" })
  expect(request.employees[0].choices).toEqual([
    { weekId: "2026-W20", rank: 1 },
    { weekId: "2026-W21", rank: 2 },
  ])
})
