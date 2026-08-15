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

/**
 * Les vœux d'une personne : trois PLANS COMPLETS, pas trois listes d'options.
 *
 * Chaque rang décrit la même absence vue autrement — « je veux deux semaines :
 * celles-ci de préférence, sinon celles-là, sinon ces dernières ». Le nombre de
 * semaines demandées n'est donc pas une donnée à part, c'est la TAILLE d'un
 * plan, et les trois portent la même.
 *
 * Il a existé comme champ, saisi à la main et laissé à zéro par défaut : une
 * personne dont les vœux s'affichaient à l'écran repartait avec un objectif nul
 * et n'obtenait rien, en silence. Un nombre qui se déduit ne peut pas être
 * oublié.
 */
export interface PaidLeaveRequest {
  readonly employeeId: string
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
