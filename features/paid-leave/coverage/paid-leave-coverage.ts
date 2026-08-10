import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import type {
  PaidLeaveCampaign,
  PaidLeaveReinforcementAllocation,
  PaidLeaveReinforcementPool,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

export type PaidLeaveCoverageState = "green" | "orange" | "red"

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
 * Weekly paid-leave coverage using each employee's primary ShiftOS sector.
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
      const rule = campaign.coverage[sector.id]?.[week.id] ?? {
        minimumHours: 0,
        toleratedDeficitHours: 0,
      }
      return {
        sectorId: sector.id,
        sectorName: sector.name,
        weekId: week.id,
        baseContractHours,
        absentHours,
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
  readonly baseContractHours: number
  readonly absentHours: number
  readonly presentHours: number
  reinforcementHours: number
  readonly minimumHours: number
  readonly toleratedDeficitHours: number
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
  const state: PaidLeaveCoverageState = totalHours >= cell.minimumHours
    ? "green"
    : totalHours >= cell.minimumHours - cell.toleratedDeficitHours
      ? "orange"
      : "red"
  return { ...cell, totalHours, deficitHours, state }
}

function contractHours(employee: EmployeeRecord): number {
  return typeof employee.weeklyMinutes === "number"
    ? employee.weeklyMinutes / 60
    : employee.weeklyHours
}

function roundHours(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
