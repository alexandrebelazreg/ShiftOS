import { describe, expect, it } from "vitest"

import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  describePaidLeaveOutcome,
  paidLeaveGenerationWarnings,
} from "@/features/paid-leave/domain/generation-report"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Ce que la génération dit avant de partir, et ce qu'elle dit en revenant.
 *
 * Le défaut corrigé ici tenait en une phrase : elle réussissait en silence.
 * « Solution optimale trouvée en 1,2 s » après zéro attribution envoyait
 * chercher ailleurs un défaut qui était sous les yeux.
 */

const WEEKS = new Set<PaidLeaveWeekId>(["2026-W20", "2026-W21", "2026-W22"])

const employee = (id: string, first: string, sector: string | null): EmployeeRecord =>
  ({
    id,
    firstName: first,
    lastName: "Test",
    status: "active",
    sectors: sector ? [sector] : [],
  }) as unknown as EmployeeRecord

const sector = (name: string): SectorDemandConfiguration =>
  ({ id: name.toLowerCase(), name, status: "active" }) as unknown as SectorDemandConfiguration

const campaign = (patch: Partial<PaidLeaveCampaign> = {}): PaidLeaveCampaign =>
  ({
    year: 2026,
    period: { kind: "custom", startWeek: 20, endWeek: 22 },
    requests: {},
    grants: {},
    ...patch,
  }) as unknown as PaidLeaveCampaign

const request = (wish1: PaidLeaveWeekId[], wish2: PaidLeaveWeekId[] = []) => ({
  employeeId: "x",
  wish1,
  wish2,
  wish3: [],
})

describe("les avertissements avant de lancer le calcul", () => {
  it("nomme qui n’a pas de rayon principal reconnu, et dit ce que ça coûte", () => {
    const warnings = paidLeaveGenerationWarnings({
      campaign: campaign({ requests: { e1: request(["2026-W20"]) } }),
      employees: [employee("e1", "Luca", "Inconnu")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
    })
    const sectorWarning = warnings.find((warning) => warning.kind === "sector")

    expect(sectorWarning?.message).toContain("Luca Test")
    expect(sectorWarning?.message).toContain("aucun minimum de couverture")
  })

  it("se tait quand le rayon est reconnu", () => {
    const warnings = paidLeaveGenerationWarnings({
      campaign: campaign({ requests: { e1: request(["2026-W20"]) } }),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
    })

    expect(warnings.map((warning) => warning.kind)).toEqual([])
  })

  it("signale les vœux tombés hors de la période", () => {
    const warnings = paidLeaveGenerationWarnings({
      campaign: campaign({ requests: { e1: request(["2026-W40"]) } }),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
    })

    expect(warnings.find((warning) => warning.kind === "orphaned-wishes")?.message).toContain(
      "hors de la période"
    )
  })

  it("signale des vœux de tailles différentes", () => {
    // Trois plans inégaux ne décrivent pas la même absence : c'est presque
    // toujours une saisie inachevée, et la personne obtiendra plus ou moins
    // que ce que le gérant croit avoir demandé.
    const warnings = paidLeaveGenerationWarnings({
      campaign: campaign({
        requests: { e1: request(["2026-W20", "2026-W21"], ["2026-W22"]) },
      }),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
    })
    const uneven = warnings.find((warning) => warning.kind === "uneven-wishes")

    expect(uneven?.message).toContain("Luca Test")
    expect(uneven?.message).toContain("le plus grand")
  })

  it("se tait quand les vœux remplis portent le même nombre", () => {
    const warnings = paidLeaveGenerationWarnings({
      campaign: campaign({
        requests: { e1: request(["2026-W20", "2026-W21"], ["2026-W21", "2026-W22"]) },
      }),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
    })

    expect(warnings.some((warning) => warning.kind === "uneven-wishes")).toBe(false)
  })

  it("signale l’absence totale de vœux, sans crier à l’incohérence", () => {
    const warnings = paidLeaveGenerationWarnings({
      campaign: campaign({ requests: {} }),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
    })

    expect(warnings.find((warning) => warning.kind === "no-wishes")?.message).toContain("Luca Test")
    expect(warnings.some((warning) => warning.kind === "uneven-wishes")).toBe(false)
  })

  it("compte au-delà de trois noms plutôt que de tous les lister", () => {
    const warnings = paidLeaveGenerationWarnings({
      campaign: campaign(),
      employees: ["a", "b", "c", "d", "e"].map((id) => employee(id, id.toUpperCase(), "Drive")),
      sectors: [sector("Drive")],
      weekIds: WEEKS,
    })

    expect(warnings.find((warning) => warning.kind === "no-wishes")?.message).toContain("2 autres")
  })

  it("ignore les salariés inactifs", () => {
    const inactive = { ...employee("e1", "Luca", null), status: "inactive" } as EmployeeRecord
    const warnings = paidLeaveGenerationWarnings({
      campaign: campaign(),
      employees: [inactive],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
    })

    expect(warnings).toEqual([])
  })
})

describe("le compte rendu du calcul", () => {
  it("dit combien de semaines ont été attribuées sur combien de demandées", () => {
    const outcome = describePaidLeaveOutcome({
      campaign: campaign({
        requests: { e1: request(["2026-W20", "2026-W21"]) },
        grants: { e1: ["2026-W20", "2026-W21"] },
      }),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
      durationMs: 1234,
    })

    expect(outcome).toMatchObject({ grantedWeeks: 2, requestedWeeks: 2, incompleteEmployees: 0 })
    expect(outcome.message).toContain("2 semaines attribuées sur 2 demandées")
    expect(outcome.message).toContain("Toutes les demandes sont servies")
  })

  it("compte les personnes restées incomplètes", () => {
    const outcome = describePaidLeaveOutcome({
      campaign: campaign({
        requests: { e1: request(["2026-W20", "2026-W21"]) },
        grants: { e1: ["2026-W20"] },
      }),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
      durationMs: 500,
    })

    expect(outcome).toMatchObject({ grantedWeeks: 1, requestedWeeks: 2, incompleteEmployees: 1 })
    expect(outcome.message).toContain("1 personne reste incomplète")
  })

  it("ne se félicite pas d’un optimum vide", () => {
    // Le cœur du défaut 4 : l'optimum d'un problème sans demande est
    // l'ensemble vide, et l'annoncer comme une réussite est un mensonge.
    const outcome = describePaidLeaveOutcome({
      campaign: campaign(),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
      durationMs: 20,
    })

    expect(outcome.message).toContain("Aucune semaine n’était demandée")
    expect(outcome.message).not.toContain("Toutes les demandes sont servies")
  })

  it("ne compte pas comme demandée une semaine hors période", () => {
    const outcome = describePaidLeaveOutcome({
      campaign: campaign({ requests: { e1: request(["2026-W40"]) }, grants: {} }),
      employees: [employee("e1", "Luca", "Drive")],
      sectors: [sector("Drive")],
      weekIds: WEEKS,
      durationMs: 10,
    })

    // Sans la correction, cette personne restait « incomplète » à vie.
    expect(outcome).toMatchObject({ requestedWeeks: 0, incompleteEmployees: 0 })
  })
})
