export const PAID_LEAVE_PERIOD_KINDS = ["summer", "winter", "custom"] as const
export type PaidLeavePeriodKind = (typeof PAID_LEAVE_PERIOD_KINDS)[number]

export const PAID_LEAVE_CAMPAIGN_STATUSES = ["editing", "validated"] as const
export type PaidLeaveCampaignStatus = (typeof PAID_LEAVE_CAMPAIGN_STATUSES)[number]

export type PaidLeaveWeekId = `${number}-W${string}`

export interface PaidLeavePeriod {
  readonly kind: PaidLeavePeriodKind
  readonly startWeek: number
  readonly endWeek: number
}

export interface PaidLeaveEmployeeSettings {
  readonly employeeId: string
  readonly priority: boolean
  readonly linkedEmployeeId: string | null
  readonly entryDate: string
  readonly firstChoiceHistory: number
}

export interface PaidLeaveRequest {
  readonly employeeId: string
  readonly requestedWeeks: number
  readonly wish1: readonly PaidLeaveWeekId[]
  readonly wish2: readonly PaidLeaveWeekId[]
  readonly wish3: readonly PaidLeaveWeekId[]
}

export interface PaidLeaveCoverageRule {
  readonly minimumHours: number
  readonly toleratedDeficitHours: number
}

export interface PaidLeaveReinforcementPool {
  readonly id: string
  readonly label: string
  readonly totalHours: number
  readonly startWeekId: PaidLeaveWeekId
  readonly endWeekId: PaidLeaveWeekId
  readonly scope: "global" | "sector"
  readonly sectorId: string | null
}

export interface PaidLeaveReinforcementAllocation {
  readonly poolId: string
  readonly sectorId: string
  readonly weekId: PaidLeaveWeekId
  readonly hours: number
}

export interface PaidLeaveCompromise {
  readonly employeeId: string
  readonly grantedWeeks: readonly PaidLeaveWeekId[]
  readonly preferenceRanks: readonly (1 | 2 | 3)[]
  readonly mixed: boolean
  readonly prioritySatisfied: boolean | null
  readonly message: string
}

export interface PaidLeaveSolution {
  readonly generatedAt: string
  readonly status: "optimal"
  readonly grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
  readonly reinforcementAllocations: readonly PaidLeaveReinforcementAllocation[]
  readonly compromises: readonly PaidLeaveCompromise[]
}

export interface PaidLeaveValidatedSnapshot {
  readonly validatedAt: string
  readonly grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
  readonly reinforcementAllocations: readonly PaidLeaveReinforcementAllocation[]
  readonly fullFirstChoiceEmployeeIds: readonly string[]
}

export interface PaidLeaveCampaign {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly year: number
  readonly period: PaidLeavePeriod
  readonly status: PaidLeaveCampaignStatus
  readonly employeeSettings: Readonly<Record<string, PaidLeaveEmployeeSettings>>
  readonly requests: Readonly<Record<string, PaidLeaveRequest>>
  readonly coverage: Readonly<
    Record<string, Readonly<Record<PaidLeaveWeekId, PaidLeaveCoverageRule>>>
  >
  readonly reinforcementPools: readonly PaidLeaveReinforcementPool[]
  readonly grants: Readonly<Record<string, readonly PaidLeaveWeekId[]>>
  readonly solution: PaidLeaveSolution | null
  readonly validatedSnapshot: PaidLeaveValidatedSnapshot | null
  readonly createdAt: string
  readonly updatedAt: string
}
