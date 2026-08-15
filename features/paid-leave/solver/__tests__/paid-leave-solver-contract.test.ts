import { expect, it } from "vitest"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeekIds, effectiveRequestedWeeks } from "@/features/paid-leave/domain/campaign"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import { buildPaidLeaveSolveRequest } from "@/features/paid-leave/solver/paid-leave-solver-contract"
import type { SectorDemandConfiguration } from "@/features/sectors"

it("construit un problème avec le meilleur rang de chaque semaine", () => {
  const campaign = {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 22 },
    status: "editing",
    employeeSettings: { alice: { employeeId: "alice", priority: false, linkedEmployeeId: null, entryDate: "2020-01-01", firstChoiceHistory: 2 } },
    // Deux plans de MÊME taille : deux semaines voulues, deux façons de les
    // prendre. W20 figure dans les deux et doit garder son meilleur rang.
    requests: { alice: { employeeId: "alice", wish1: ["2026-W20", "2026-W21"], wish2: ["2026-W20", "2026-W22"], wish3: [] } },
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
  expect(request.employees[0]).toMatchObject({ targetWeeks: 2, sectorId: "caisse" })
  expect(request.employees[0].choices).toEqual([
    { weekId: "2026-W20", rank: 1 },
    { weekId: "2026-W21", rank: 1 },
    { weekId: "2026-W22", rank: 2 },
  ])
})

it("vise exactement ce que la validation attendra, vœux hors période compris", () => {
  // LE DÉFAUT CORRIGÉ : le solveur filtrait les vœux hors période, la
  // validation les comptait quand même. L'écart ne se refermait jamais et la
  // campagne devenait invalidable à vie, sans message.
  const campaign = {
    id: "c1",
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 21 },
    employeeSettings: {},
    // Deux semaines demandées, dont une hors de la période 20–21.
    requests: { alice: { employeeId: "alice", wish1: ["2026-W20"], wish2: ["2026-W40"], wish3: [] } },
    coverage: {},
    reinforcementPools: [],
    grants: {},
  } as unknown as PaidLeaveCampaign
  const employees = [{ id: "alice", firstName: "Alice", lastName: "Test", status: "active", sectors: ["Caisse"], weeklyHours: 35, createdAt: "2020-01-01T00:00:00.000Z" }] as EmployeeRecord[]
  const sectors = [{ id: "caisse", name: "Caisse", status: "active" }] as SectorDemandConfiguration[]

  const request = buildPaidLeaveSolveRequest({ campaign, employees, sectors })
  const weekIds = campaignWeekIds(campaign)

  // Le solveur vise une semaine…
  expect(request.employees[0].targetWeeks).toBe(1)
  // …et c'est exactement ce que la validation exigera.
  expect(effectiveRequestedWeeks(campaign.requests.alice, weekIds)).toBe(1)
})

it("laisse à null le secteur d’un salarié dont le rayon n’est pas reconnu", () => {
  // Sa cellule de couverture n'existera pas côté solveur : son absence ne
  // pèsera sur aucun minimum. C'est l'avertissement que l'écran doit donner.
  const campaign = {
    id: "c1",
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 21 },
    employeeSettings: {},
    requests: { alice: { employeeId: "alice", wish1: ["2026-W20"], wish2: [], wish3: [] } },
    coverage: {},
    reinforcementPools: [],
    grants: {},
  } as unknown as PaidLeaveCampaign
  const employees = [{ id: "alice", firstName: "Alice", lastName: "Test", status: "active", sectors: ["Rayon disparu"], weeklyHours: 35, createdAt: "2020-01-01T00:00:00.000Z" }] as EmployeeRecord[]
  const sectors = [{ id: "caisse", name: "Caisse", status: "active" }] as SectorDemandConfiguration[]

  expect(buildPaidLeaveSolveRequest({ campaign, employees, sectors }).employees[0].sectorId).toBeNull()
})
