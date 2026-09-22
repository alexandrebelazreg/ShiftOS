import { expect, it } from "vitest"

import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeekIds, effectiveRequestedWeeks } from "@/features/paid-leave/domain/campaign"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import { buildPaidLeaveSolveRequest } from "@/features/paid-leave/solver/paid-leave-solver-contract"
import type { SectorDemandConfiguration } from "@/features/sectors"

it("envoie les plans tels quels, chevauchements compris", () => {
  const campaign = {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 22 },
    status: "editing",
    employeeSettings: { alice: { employeeId: "alice", priority: false, linkedEmployeeId: null, entryDate: "2020-01-01", firstChoiceHistory: 2 } },
    // Deux plans de MÊME taille : deux semaines voulues, deux façons de les
    // prendre. W20 figure dans les deux, et son APPARTENANCE aux deux doit
    // survivre au transport — c'est précisément ce que l'ancienne liste à plat
    // `{semaine, meilleur rang}` détruisait.
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
  expect(request.employees[0].plans).toEqual([
    { rank: 1, weekIds: ["2026-W20", "2026-W21"] },
    { rank: 2, weekIds: ["2026-W20", "2026-W22"] },
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

it("marque les semaines où la personne est déjà absente, sans réduire sa cible", () => {
  // Une campagne de trois semaines, dont la deuxième tombe sur un arrêt.
  const campaign = {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 30, endWeek: 32 },
    status: "editing",
    employeeSettings: { alice: { employeeId: "alice", priority: false, linkedEmployeeId: null, entryDate: "2020-01-01", firstChoiceHistory: 0 } },
    requests: { alice: { employeeId: "alice", wish1: ["2026-W30", "2026-W31"], wish2: [], wish3: [] } },
    coverage: {},
    reinforcementPools: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as PaidLeaveCampaign
  const employees = [{ id: "alice", firstName: "Alice", lastName: "Test", status: "active", sectors: ["Caisse"], weeklyHours: 35, createdAt: "2020-01-01T00:00:00.000Z" }] as EmployeeRecord[]
  const sectors = [{ id: "caisse", name: "Caisse", status: "active" }] as SectorDemandConfiguration[]
  // Semaine 31 : du lundi 27 juillet au dimanche 2 août 2026.
  const absences = [
    { id: "a1", employeeId: "alice", type: "sick_leave", start: "2026-07-28", end: "2026-07-30" },
  ] as AbsenceRecord[]

  const request = buildPaidLeaveSolveRequest({ campaign, employees, sectors, absences })
  expect(request.employees[0].unavailableWeekIds).toEqual(["2026-W31"])
  // LA CIBLE NE BOUGE PAS. Elle a demandé deux semaines ; ne pas pouvoir lui en
  // donner une est un manque à annoncer, pas une demande à réécrire.
  expect(request.employees[0].targetWeeks).toBe(2)
})

it("n’envoie aucune semaine bloquée quand rien n’est posé ailleurs", () => {
  const campaign = {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 30, endWeek: 32 },
    status: "editing",
    employeeSettings: {},
    requests: { alice: { employeeId: "alice", wish1: ["2026-W30"], wish2: [], wish3: [] } },
    coverage: {},
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
  expect(request.employees[0].unavailableWeekIds).toEqual([])
})

it("borne la cible au solde restant, et n’invente rien sans solde", () => {
  // Le défaut : la cible venait du vœu, jamais d'un droit. Alice demande trois
  // semaines ; il ne lui en reste qu'une. Le solveur ne doit viser qu'une.
  const base = {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 24 },
    status: "editing",
    requests: {
      alice: {
        employeeId: "alice",
        wish1: ["2026-W20", "2026-W21", "2026-W22"],
        wish2: [],
        wish3: [],
      },
    },
    coverage: {},
    reinforcementPools: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
  const employees = [{ id: "alice", firstName: "Alice", lastName: "Test", status: "active", sectors: ["Caisse"], weeklyHours: 35, createdAt: "2020-01-01T00:00:00.000Z" }] as EmployeeRecord[]
  const sectors = [{ id: "caisse", name: "Caisse", status: "active" }] as SectorDemandConfiguration[]
  const settings = (entitlementWeeks: number | null) => ({
    alice: { employeeId: "alice", priority: false, linkedEmployeeId: null, entryDate: "2020-01-01", firstChoiceHistory: 0, entitlementWeeks },
  })

  const borne = buildPaidLeaveSolveRequest({
    campaign: { ...base, employeeSettings: settings(1) } as PaidLeaveCampaign,
    employees,
    sectors,
  })
  expect(borne.employees[0].targetWeeks).toBe(1)

  // Sans solde connu, rien ne change : le comportement d'avant ce champ.
  const libre = buildPaidLeaveSolveRequest({
    campaign: { ...base, employeeSettings: settings(null) } as PaidLeaveCampaign,
    employees,
    sectors,
  })
  expect(libre.employees[0].targetWeeks).toBe(3)

  // Zéro ferme la campagne à cette personne, et ce n'est pas « inconnu ».
  const epuise = buildPaidLeaveSolveRequest({
    campaign: { ...base, employeeSettings: settings(0) } as PaidLeaveCampaign,
    employees,
    sectors,
  })
  expect(epuise.employees[0].targetWeeks).toBe(0)
})
