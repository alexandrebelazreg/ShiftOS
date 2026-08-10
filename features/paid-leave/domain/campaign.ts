import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  campaignWeeks,
  defaultPeriod,
} from "@/features/paid-leave/calendar/campaign-weeks"
import type {
  PaidLeaveCampaign,
  PaidLeaveEmployeeSettings,
  PaidLeavePeriodKind,
  PaidLeaveRequest,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

export function createPaidLeaveCampaign({
  id,
  year,
  kind,
  employees,
  sectors,
  previousCampaigns = [],
  now,
}: {
  readonly id: string
  readonly year: number
  readonly kind: PaidLeavePeriodKind
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly previousCampaigns?: readonly PaidLeaveCampaign[]
  readonly now: string
}): PaidLeaveCampaign {
  const period = defaultPeriod(kind)
  const weeks = campaignWeeks(year, period)
  const activeEmployees = employees.filter((employee) => employee.status === "active")
  const activeSectors = sectors.filter((sector) => sector.status === "active")
  const name = kind === "summer"
    ? `Été ${year}`
    : kind === "winter"
      ? `Hiver ${year}–${year + 1}`
      : `Période personnalisée ${year}`

  return {
    schemaVersion: 1,
    id,
    name,
    year,
    period,
    status: "editing",
    employeeSettings: Object.fromEntries(
      activeEmployees.map((employee) => [
        employee.id,
        defaultEmployeeSettings(employee, previousCampaigns),
      ])
    ),
    requests: Object.fromEntries(
      activeEmployees.map((employee) => [employee.id, emptyRequest(employee.id)])
    ),
    coverage: Object.fromEntries(
      activeSectors.map((sector) => [
        sector.id,
        Object.fromEntries(
          weeks.map((week) => [
            week.id,
            { minimumHours: 0, toleratedDeficitHours: 0 },
          ])
        ),
      ])
    ),
    reinforcementPools: [],
    grants: {},
    solution: null,
    validatedSnapshot: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function synchronizePaidLeaveCampaign(
  campaign: PaidLeaveCampaign,
  employees: readonly EmployeeRecord[],
  sectors: readonly SectorDemandConfiguration[],
  previousCampaigns: readonly PaidLeaveCampaign[]
): PaidLeaveCampaign {
  const weeks = campaignWeeks(campaign.year, campaign.period)
  const employeeSettings = { ...campaign.employeeSettings }
  const requests = { ...campaign.requests }
  for (const employee of employees.filter((item) => item.status === "active")) {
    employeeSettings[employee.id] ??= defaultEmployeeSettings(employee, previousCampaigns)
    requests[employee.id] ??= emptyRequest(employee.id)
  }

  const coverage = { ...campaign.coverage }
  for (const sector of sectors.filter((item) => item.status === "active")) {
    const existing = coverage[sector.id] ?? {}
    coverage[sector.id] = Object.fromEntries(
      weeks.map((week) => [
        week.id,
        existing[week.id] ?? { minimumHours: 0, toleratedDeficitHours: 0 },
      ])
    )
  }

  return { ...campaign, employeeSettings, requests, coverage }
}

export function effectiveRequestedWeeks(request: PaidLeaveRequest): number {
  const selected = new Set([...request.wish1, ...request.wish2, ...request.wish3])
  return Math.min(Math.max(0, Math.round(request.requestedWeeks)), selected.size)
}

export function preferenceRank(
  request: PaidLeaveRequest,
  weekId: PaidLeaveWeekId
): 1 | 2 | 3 | null {
  if (request.wish1.includes(weekId)) return 1
  if (request.wish2.includes(weekId)) return 2
  if (request.wish3.includes(weekId)) return 3
  return null
}

export function togglePaidLeaveWish(
  request: PaidLeaveRequest,
  rank: 1 | 2 | 3,
  weekId: PaidLeaveWeekId
): PaidLeaveRequest {
  const toggle = (weeks: readonly PaidLeaveWeekId[]) =>
    weeks.includes(weekId)
      ? weeks.filter((item) => item !== weekId)
      : [...weeks, weekId]

  if (rank === 1) return { ...request, wish1: toggle(request.wish1) }
  if (rank === 2) return { ...request, wish2: toggle(request.wish2) }
  return { ...request, wish3: toggle(request.wish3) }
}

export function grantIsEntirelyFirstChoice(
  request: PaidLeaveRequest,
  grants: readonly PaidLeaveWeekId[]
): boolean {
  const target = effectiveRequestedWeeks(request)
  return target > 0 && grants.length === target && grants.every((week) => request.wish1.includes(week))
}

export function linkPriorityEmployees(
  settings: Readonly<Record<string, PaidLeaveEmployeeSettings>>,
  employeeId: string,
  linkedEmployeeId: string | null
): Readonly<Record<string, PaidLeaveEmployeeSettings>> {
  const next = { ...settings }
  const current = next[employeeId]
  if (!current) return settings

  if (current.linkedEmployeeId && next[current.linkedEmployeeId]) {
    next[current.linkedEmployeeId] = {
      ...next[current.linkedEmployeeId],
      linkedEmployeeId: null,
    }
  }
  next[employeeId] = {
    ...current,
    linkedEmployeeId,
  }

  if (linkedEmployeeId && next[linkedEmployeeId]) {
    const previousPartner = next[linkedEmployeeId].linkedEmployeeId
    if (previousPartner && previousPartner !== employeeId && next[previousPartner]) {
      next[previousPartner] = {
        ...next[previousPartner],
        linkedEmployeeId: null,
      }
    }
    next[linkedEmployeeId] = {
      ...next[linkedEmployeeId],
      linkedEmployeeId: employeeId,
    }
  }
  return next
}

export function historyFromCampaigns(
  employeeId: string,
  campaigns: readonly PaidLeaveCampaign[]
): number {
  return campaigns.reduce(
    (count, campaign) =>
      count + (campaign.validatedSnapshot?.fullFirstChoiceEmployeeIds.includes(employeeId) ? 1 : 0),
    0
  )
}

function defaultEmployeeSettings(
  employee: EmployeeRecord,
  previousCampaigns: readonly PaidLeaveCampaign[]
): PaidLeaveEmployeeSettings {
  return {
    employeeId: employee.id,
    priority: false,
    linkedEmployeeId: null,
    entryDate: employee.createdAt.slice(0, 10),
    firstChoiceHistory: historyFromCampaigns(employee.id, previousCampaigns),
  }
}

function emptyRequest(employeeId: string): PaidLeaveRequest {
  return { employeeId, requestedWeeks: 0, wish1: [], wish2: [], wish3: [] }
}
