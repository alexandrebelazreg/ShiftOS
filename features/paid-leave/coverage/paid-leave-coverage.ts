import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import { activeClosureWeeks } from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveCampaign,
  PaidLeaveReinforcementAllocation,
  PaidLeaveReinforcementPool,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * `closed` n'est PAS une quatrième couleur : c'est l'absence de question.
 *
 * Une semaine de fermeture n'a ni minimum à tenir ni équipe pour le tenir. La
 * peindre en vert dirait « tout va bien » là où rien n'a été vérifié ; la
 * peindre en rouge accuserait le gérant d'un manque qu'il a décidé lui-même.
 * C'est aussi ce que fait le solveur, qui saute purement la ligne.
 */
export type PaidLeaveCoverageState = "green" | "orange" | "red" | "closed"

export interface PaidLeaveCoverageCell {
  readonly sectorId: string
  readonly sectorName: string
  readonly weekId: PaidLeaveWeekId
  readonly baseContractHours: number
  readonly absentHours: number
  readonly presentHours: number
  readonly reinforcementHours: number
  readonly totalHours: number
  readonly minimumHours: number
  readonly toleratedDeficitHours: number
  readonly deficitHours: number
  /** Combien de personnes du rayon sont absentes cette semaine-là. */
  readonly absentCount: number
  /** Le plafond réglé, ou `null` quand seules les heures décident. */
  readonly maximumAbsent: number | null
  /**
   * Combien de personnes EN TROP par rapport au plafond. Zéro quand il est
   * tenu, ou qu'il n'y en a pas.
   *
   * Rendu à part de `state` parce que la couleur ne dit pas la cause : une
   * cellule rouge par manque d'heures se rattrape avec du renfort, une cellule
   * rouge par dépassement d'effectif ne se rattrape qu'en déplaçant un congé.
   */
  readonly headcountBreach: number
  /** Le magasin ferme cette semaine-là : il n'y a rien à couvrir. */
  readonly closed: boolean
  readonly state: PaidLeaveCoverageState
}

export interface PaidLeavePoolUsage {
  readonly poolId: string
  readonly label: string
  readonly totalHours: number
  readonly usedHours: number
  readonly remainingHours: number
}

export interface PaidLeaveCoverageSummary {
  readonly cells: readonly PaidLeaveCoverageCell[]
  readonly reinforcementAllocations: readonly PaidLeaveReinforcementAllocation[]
  readonly pools: readonly PaidLeavePoolUsage[]
  readonly redCellCount: number
  readonly orangeCellCount: number
}

/**
 * Weekly paid-leave coverage using each employee's primary Planiteo sector.
 * Reinforcement pools are spread only where a deficit exists and are never
 * consumed merely because they are available.
 */
export function calculatePaidLeaveCoverage({
  campaign,
  employees,
  sectors,
  grants = campaign.grants,
  reinforcementAllocations,
}: {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly grants?: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
  readonly reinforcementAllocations?: readonly PaidLeaveReinforcementAllocation[]
}): PaidLeaveCoverageSummary {
  const activeSectors = sectors.filter((sector) => sector.status === "active")
  const weeks = campaignWeeks(campaign.year, campaign.period)
  const closed = activeClosureWeeks(campaign)
  const employeesBySector = new Map<string, EmployeeRecord[]>()

  for (const employee of employees.filter((item) => item.status === "active")) {
    const primaryName = employee.sectors?.[0]
    const sector = activeSectors.find((item) => item.name === primaryName)
    if (!sector) continue
    employeesBySector.set(sector.id, [...(employeesBySector.get(sector.id) ?? []), employee])
  }

  const drafts: MutableCoverageCell[] = activeSectors.flatMap((sector) => {
    const team = employeesBySector.get(sector.id) ?? []
    const baseContractHours = roundHours(team.reduce((sum, employee) => sum + contractHours(employee), 0))
    return weeks.map((week) => {
      const absentHours = roundHours(
        team.reduce(
          (sum, employee) => sum + (grants[employee.id]?.includes(week.id) ? contractHours(employee) : 0),
          0
        )
      )
      const absentCount = team.reduce(
        (count, employee) => count + (grants[employee.id]?.includes(week.id) ? 1 : 0),
        0
      )
      const rule = campaign.coverage[sector.id]?.[week.id] ?? {
        minimumHours: 0,
        toleratedDeficitHours: 0,
        maximumAbsent: null,
      }
      return {
        sectorId: sector.id,
        sectorName: sector.name,
        weekId: week.id,
        closed: closed.has(week.id),
        baseContractHours,
        absentHours,
        absentCount,
        maximumAbsent: rule.maximumAbsent ?? null,
        presentHours: roundHours(baseContractHours - absentHours),
        reinforcementHours: 0,
        minimumHours: Math.max(0, rule.minimumHours),
        toleratedDeficitHours: Math.max(0, rule.toleratedDeficitHours),
      }
    })
  })

  const allocations = reinforcementAllocations
    ? applyDeclaredAllocations(drafts, campaign.reinforcementPools, reinforcementAllocations)
    : allocateReinforcementPools(drafts, campaign.reinforcementPools)
  const cells = drafts.map(finalizeCell)
  const usedByPool = allocations.reduce(
    (map, allocation) => map.set(
      allocation.poolId,
      roundHours((map.get(allocation.poolId) ?? 0) + allocation.hours)
    ),
    new Map<string, number>()
  )

  return {
    cells,
    reinforcementAllocations: allocations,
    pools: campaign.reinforcementPools.map((pool) => {
      const usedHours = usedByPool.get(pool.id) ?? 0
      return {
        poolId: pool.id,
        label: pool.label,
        totalHours: pool.totalHours,
        usedHours,
        remainingHours: roundHours(Math.max(0, pool.totalHours - usedHours)),
      }
    }),
    redCellCount: cells.filter((cell) => cell.state === "red").length,
    orangeCellCount: cells.filter((cell) => cell.state === "orange").length,
  }
}

interface MutableCoverageCell {
  readonly sectorId: string
  readonly sectorName: string
  readonly weekId: PaidLeaveWeekId
  readonly closed: boolean
  readonly baseContractHours: number
  readonly absentHours: number
  readonly absentCount: number
  readonly presentHours: number
  reinforcementHours: number
  readonly minimumHours: number
  readonly toleratedDeficitHours: number
  readonly maximumAbsent: number | null
}

function allocateReinforcementPools(
  cells: MutableCoverageCell[],
  pools: readonly PaidLeaveReinforcementPool[]
): PaidLeaveReinforcementAllocation[] {
  const allocations: PaidLeaveReinforcementAllocation[] = []
  const orderedPools = [...pools].sort((left, right) => {
    if (left.scope !== right.scope) return left.scope === "sector" ? -1 : 1
    return left.startWeekId.localeCompare(right.startWeekId) || left.id.localeCompare(right.id)
  })

  for (const pool of orderedPools) {
    let remaining = Math.max(0, pool.totalHours)
    const candidates = cells
      .filter((cell) => poolApplies(pool, cell))
      .sort(compareCoverageNeeds)

    for (const cell of candidates) {
      if (remaining <= 0) break
      const need = Math.max(
        0,
        cell.minimumHours - cell.presentHours - cell.reinforcementHours
      )
      const hours = roundHours(Math.min(remaining, need))
      if (hours <= 0) continue
      cell.reinforcementHours = roundHours(cell.reinforcementHours + hours)
      remaining = roundHours(remaining - hours)
      allocations.push({
        poolId: pool.id,
        sectorId: cell.sectorId,
        weekId: cell.weekId,
        hours,
      })
    }
  }
  return allocations
}

function applyDeclaredAllocations(
  cells: MutableCoverageCell[],
  pools: readonly PaidLeaveReinforcementPool[],
  declared: readonly PaidLeaveReinforcementAllocation[]
): PaidLeaveReinforcementAllocation[] {
  const poolById = new Map(pools.map((pool) => [pool.id, pool]))
  const remainingByPool = new Map(pools.map((pool) => [pool.id, Math.max(0, pool.totalHours)]))
  const applied: PaidLeaveReinforcementAllocation[] = []

  for (const allocation of declared) {
    const pool = poolById.get(allocation.poolId)
    const cell = cells.find(
      (item) => item.sectorId === allocation.sectorId && item.weekId === allocation.weekId
    )
    if (!pool || !cell || !poolApplies(pool, cell)) continue
    const remaining = remainingByPool.get(pool.id) ?? 0
    const hours = roundHours(Math.min(Math.max(0, allocation.hours), remaining))
    if (hours <= 0) continue
    cell.reinforcementHours = roundHours(cell.reinforcementHours + hours)
    remainingByPool.set(pool.id, roundHours(remaining - hours))
    applied.push({ ...allocation, hours })
  }
  return applied
}

function poolApplies(pool: PaidLeaveReinforcementPool, cell: MutableCoverageCell): boolean {
  return (
    cell.weekId >= pool.startWeekId &&
    cell.weekId <= pool.endWeekId &&
    (pool.scope === "global" || pool.sectorId === cell.sectorId)
  )
}

function compareCoverageNeeds(left: MutableCoverageCell, right: MutableCoverageCell): number {
  const leftHardGap = Math.max(
    0,
    left.minimumHours - left.toleratedDeficitHours - left.presentHours - left.reinforcementHours
  )
  const rightHardGap = Math.max(
    0,
    right.minimumHours - right.toleratedDeficitHours - right.presentHours - right.reinforcementHours
  )
  const leftGap = Math.max(0, left.minimumHours - left.presentHours - left.reinforcementHours)
  const rightGap = Math.max(0, right.minimumHours - right.presentHours - right.reinforcementHours)
  return rightHardGap - leftHardGap || rightGap - leftGap || left.weekId.localeCompare(right.weekId) || left.sectorId.localeCompare(right.sectorId)
}

function finalizeCell(cell: MutableCoverageCell): PaidLeaveCoverageCell {
  const totalHours = roundHours(cell.presentHours + cell.reinforcementHours)
  const deficitHours = roundHours(Math.max(0, cell.minimumHours - totalHours))
  /**
   * LE PLAFOND D'EFFECTIF EST UNE VIOLATION DURE, comme le plancher d'heures.
   *
   * Cet écran l'ignorait alors que le solveur l'applique : il affichait en vert
   * des semaines que le calcul refusait, et le bouton de validation s'ouvrait
   * sur une répartition impossible. Un écran qui prédit autre chose que ce qui
   * sera calculé est pire qu'un écran qui ne prédit rien.
   *
   * Aucune marge ici, et c'est voulu : la tolérance est exprimée en HEURES,
   * elle ne dit rien d'un nombre de personnes. Le plafond se tient ou ne se
   * tient pas.
   */
  const headcountBreach = cell.maximumAbsent === null
    ? 0
    : Math.max(0, cell.absentCount - cell.maximumAbsent)
  // La fermeture passe AVANT tout le reste, plafond compris : une semaine où
  // personne ne travaille ne peut violer aucune règle de présence. Le solveur
  // saute la ligne entière ; l'écran doit dire la même chose, sinon il annonce
  // un rouge que le calcul ne verra jamais.
  const state: PaidLeaveCoverageState = cell.closed
    ? "closed"
    : headcountBreach > 0
    ? "red"
    : totalHours >= cell.minimumHours
      ? "green"
      : totalHours >= cell.minimumHours - cell.toleratedDeficitHours
        ? "orange"
        : "red"
  return { ...cell, totalHours, deficitHours, headcountBreach, state }
}

function contractHours(employee: EmployeeRecord): number {
  return typeof employee.weeklyMinutes === "number"
    ? employee.weeklyMinutes / 60
    : employee.weeklyHours
}

function roundHours(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
