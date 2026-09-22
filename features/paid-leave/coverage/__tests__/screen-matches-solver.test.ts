import { describe, expect, it } from "vitest"

import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { calculatePaidLeaveCoverage } from "@/features/paid-leave/coverage/paid-leave-coverage"
import {
  buildPaidLeaveProjection,
  describePaidLeaveTension,
  wishOneScenario,
} from "@/features/paid-leave/coverage/paid-leave-projection"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * L'écran doit dire ce que le solveur fera.
 *
 * Deux règles ont été ajoutées au solveur — le plafond d'absents simultanés et
 * le croisement avec les absences déjà enregistrées — sans que la couverture
 * affichée les apprenne. Elle affichait donc en vert des semaines que le calcul
 * refuse, et le bouton de validation s'ouvrait sur une répartition impossible.
 *
 * Ce n'était plus un doublon inoffensif entre deux implémentations : c'était une
 * DIVERGENCE. Un écran qui prédit autre chose que ce qui sera calculé est pire
 * qu'un écran qui ne prédit rien — le premier se croit, le second se vérifie.
 */

const sector = (id: string, name: string) =>
  ({ id, name, status: "active" }) as SectorDemandConfiguration

const employee = (id: string, sectorName: string, hours = 35) =>
  ({
    id,
    firstName: id,
    lastName: "Test",
    status: "active",
    sectors: [sectorName],
    weeklyHours: hours,
  }) as EmployeeRecord

/** Semaine 30 de 2026 : du lundi 20 au dimanche 26 juillet. */
const WEEK = "2026-W30"

function campaign(patch: Partial<PaidLeaveCampaign> = {}): PaidLeaveCampaign {
  return {
    schemaVersion: 1,
    id: "summer",
    name: "Été 2026",
    year: 2026,
    period: { kind: "custom", startWeek: 30, endWeek: 30 },
    status: "editing",
    employeeSettings: {},
    requests: {},
    coverage: { drive: { [WEEK]: { minimumHours: 0, toleratedDeficitHours: 0, maximumAbsent: null } } },
    reinforcementPools: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  } as PaidLeaveCampaign
}

describe("le plafond d’absents, tel que l’écran le voit", () => {
  const team = [employee("alice", "Drive"), employee("bob", "Drive"), employee("chloe", "Drive")]

  it("passe au rouge quand trop de monde part, même avec assez d’heures", () => {
    // Trois absents sur trois, minimum d’heures à zéro : côté heures, tout va
    // bien. C’est le plafond qui ne tient pas, et lui seul.
    const summary = calculatePaidLeaveCoverage({
      campaign: campaign({
        coverage: { drive: { [WEEK]: { minimumHours: 0, toleratedDeficitHours: 0, maximumAbsent: 2 } } },
        grants: { alice: [WEEK], bob: [WEEK], chloe: [WEEK] },
      }),
      employees: team,
      sectors: [sector("drive", "Drive")],
    })
    const cell = summary.cells[0]

    expect(cell.absentCount).toBe(3)
    expect(cell.maximumAbsent).toBe(2)
    expect(cell.headcountBreach).toBe(1)
    expect(cell.deficitHours).toBe(0)
    expect(cell.state).toBe("red")
    // C’est ce compteur qui ferme le bouton de validation.
    expect(summary.redCellCount).toBe(1)
  })

  it("reste vert quand le plafond est tenu", () => {
    const summary = calculatePaidLeaveCoverage({
      campaign: campaign({
        coverage: { drive: { [WEEK]: { minimumHours: 0, toleratedDeficitHours: 0, maximumAbsent: 2 } } },
        grants: { alice: [WEEK], bob: [WEEK] },
      }),
      employees: team,
      sectors: [sector("drive", "Drive")],
    })

    expect(summary.cells[0].headcountBreach).toBe(0)
    expect(summary.cells[0].state).toBe("green")
  })

  it("ne plafonne rien quand la case est vide", () => {
    // `null` est le réglage d’avant ce champ, et celui de toute campagne qui n’y
    // a pas touché : seules les heures décident, comme auparavant.
    const summary = calculatePaidLeaveCoverage({
      campaign: campaign({ grants: { alice: [WEEK], bob: [WEEK], chloe: [WEEK] } }),
      employees: team,
      sectors: [sector("drive", "Drive")],
    })

    expect(summary.cells[0].absentCount).toBe(3)
    expect(summary.cells[0].maximumAbsent).toBeNull()
    expect(summary.cells[0].headcountBreach).toBe(0)
    expect(summary.cells[0].state).toBe("green")
  })

  it("aucune marge ne rachète un dépassement d’effectif", () => {
    // La tolérance s’exprime en HEURES : elle ne dit rien d’un nombre de
    // personnes, et ne doit donc pas adoucir un plafond dépassé.
    const summary = calculatePaidLeaveCoverage({
      campaign: campaign({
        coverage: { drive: { [WEEK]: { minimumHours: 0, toleratedDeficitHours: 999, maximumAbsent: 1 } } },
        grants: { alice: [WEEK], bob: [WEEK] },
      }),
      employees: team,
      sectors: [sector("drive", "Drive")],
    })

    expect(summary.cells[0].state).toBe("red")
  })
})

describe("le scénario « chacun son premier vœu »", () => {
  const arret = [
    { id: "a1", employeeId: "alice", type: "sick_leave", start: "2026-07-21", end: "2026-07-23" },
  ] as AbsenceRecord[]

  const base = campaign({
    requests: { alice: { employeeId: "alice", wish1: [WEEK], wish2: [], wish3: [] } },
  })

  it("n’accorde pas une semaine où la personne est déjà absente", () => {
    expect(wishOneScenario(base, [employee("alice", "Drive")], arret)).toEqual({ alice: [] })
  })

  it("l’accorde quand rien n’est posé ailleurs", () => {
    expect(wishOneScenario(base, [employee("alice", "Drive")])).toEqual({ alice: [WEEK] })
  })

  it("ne compte donc plus une absence en double dans la tension", () => {
    // Sans ce croisement, le scénario comptait Alice absente pour congés une
    // semaine où elle l’est déjà pour maladie : il annonçait une tension qui
    // n’existe pas, et envoyait chercher du renfort pour rien.
    const serre = campaign({
      requests: { alice: { employeeId: "alice", wish1: [WEEK], wish2: [], wish3: [] } },
      coverage: { drive: { [WEEK]: { minimumHours: 35, toleratedDeficitHours: 0, maximumAbsent: null } } },
    })
    const employees = [employee("alice", "Drive")]
    const sectors = [sector("drive", "Drive")]

    expect(
      buildPaidLeaveProjection({ campaign: serre, employees, sectors }).criticalWeeks
    ).toHaveLength(1)
    expect(
      buildPaidLeaveProjection({ campaign: serre, employees, sectors, absences: arret })
        .criticalWeeks
    ).toHaveLength(0)
  })
})

describe("une semaine qui ne coince que par l’effectif", () => {
  const team = [employee("alice", "Drive"), employee("bob", "Drive")]
  const sectors = [sector("drive", "Drive")]
  const serre = campaign({
    requests: {
      alice: { employeeId: "alice", wish1: [WEEK], wish2: [], wish3: [] },
      bob: { employeeId: "bob", wish1: [WEEK], wish2: [], wish3: [] },
    },
    coverage: { drive: { [WEEK]: { minimumHours: 0, toleratedDeficitHours: 0, maximumAbsent: 1 } } },
  })

  it("apparaît dans les semaines critiques, et dit combien de personnes en trop", () => {
    // Elle était invisible : la liste ne retenait que les heures manquantes, et
    // il n’en manque aucune ici. La cellule était rouge, la liste vide.
    const projection = buildPaidLeaveProjection({ campaign: serre, employees: team, sectors })

    expect(projection.criticalWeeks).toHaveLength(1)
    expect(projection.criticalWeeks[0].missingHours).toBe(0)
    expect(projection.criticalWeeks[0].exceedingAbsent).toBe(1)
    // Aucune heure à trouver : le renfort n’est pas le sujet.
    expect(projection.reinforcementNeededHours).toBe(0)
  })

  it("le verdict ne propose pas du renfort qui n’y peut rien", () => {
    const tension = describePaidLeaveTension(
      buildPaidLeaveProjection({ campaign: serre, employees: team, sectors })
    )

    expect(tension.critical).toBe(true)
    expect(tension.headline).toContain("absents autorisés")
    expect(tension.remedy).toContain("déplacer un congé")
  })
})

/**
 * UNE SEMAINE ORANGE EST-ELLE « TENDUE » ? Les deux écrans doivent répondre la
 * même chose.
 *
 * La grille la peint en ORANGE — elle passe sous son minimum, mais la marge que
 * le gérant a lui-même réglée l'absorbe. Le verdict, lui, la COMPTE parmi les
 * semaines critiques, et sa phrase est exacte : elle passe bien sous son
 * minimum.
 *
 * Les deux lectures sont défendables, et c'est précisément le danger. Le
 * bandeau de tension de l'onglet Vœux a d'abord compté les rouges seulement :
 * deux écrans auraient annoncé deux nombres pour un seul scénario, et le gérant
 * aurait cru à un changement en passant d'un onglet à l'autre. Il reprend
 * désormais cette phrase-ci mot pour mot — ce test la fige.
 */
describe("une semaine sur la marge tolérée", () => {
  const team = [employee("alice", "Drive"), employee("bob", "Drive")]
  const sectors = [sector("drive", "Drive")]
  // Deux temps pleins, 70 h de base. Minimum 50 h, marge 20 h : un seul absent
  // laisse 35 h — sous le minimum, mais dans la marge.
  const tolerante = campaign({
    coverage: { drive: { [WEEK]: { minimumHours: 50, toleratedDeficitHours: 20, maximumAbsent: null } } },
    requests: { alice: { employeeId: "alice", wish1: [WEEK], wish2: [], wish3: [] } },
  })

  it("se peint en orange dans la grille", () => {
    const summary = calculatePaidLeaveCoverage({
      campaign: tolerante,
      employees: team,
      sectors,
      grants: wishOneScenario(tolerante, team),
      reinforcementAllocations: [],
    })

    expect(summary.cells[0].state).toBe("orange")
    expect(summary.redCellCount).toBe(0)
  })

  it("compte quand même parmi les semaines critiques du verdict", () => {
    // Elle passe sous son minimum : la phrase le dit, et c'est ce nombre-là que
    // les DEUX écrans affichent.
    const projection = buildPaidLeaveProjection({ campaign: tolerante, employees: team, sectors })
    const tension = describePaidLeaveTension(projection)

    expect(projection.criticalWeeks).toHaveLength(1)
    expect(tension.critical).toBe(true)
    expect(tension.headline).toContain("minimum de couverture")
  })
})

