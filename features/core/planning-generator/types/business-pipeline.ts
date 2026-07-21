import type { EmployeeId, WeekDay } from "@/features/core/models"

export interface SectorPlanningRules {
  readonly id: string
  readonly name: string
  readonly active: boolean
  readonly weeklyDistribution: Readonly<Record<WeekDay, number>>
  readonly minimumShiftDuration: number
  readonly splitShiftAllowed: boolean
  readonly maximumSplitDuration: number | null
  readonly assignedEmployeeIds: readonly EmployeeId[]
  readonly requirementIds: readonly string[]
  readonly workEveryNonFixedRestDay?: boolean
  readonly hours?: readonly { readonly day: WeekDay; readonly closed: boolean; readonly opensAt: string; readonly closesAt: string }[]
}

export interface EmployeePlanningPreference {
  readonly employeeId: EmployeeId
  readonly prefersClosing: boolean
}

export interface BusinessPlanningContext {
  readonly sectors?: readonly SectorPlanningRules[]
  readonly employeePreferences?: readonly EmployeePlanningPreference[]
}

export interface RepairAttemptStatistics {
  readonly family: string
  readonly generated: number
  readonly rejected: number
  readonly evaluated: number
  readonly accepted: number
}

export type PipelinePhaseName = "validation" | "demand-calculation" | "weekly-allocation" | "daily-placement" | "closing-assignment" | "legal-rest" | "opening-assignment" | "coverage" | "contract-completion" | "global-weekly-repair" | "optimisation" | "final-validation"
export interface PlanningExplanation { readonly phase: PipelinePhaseName; readonly assignmentId?: string; readonly employeeId?: EmployeeId; readonly requirementId?: string; readonly message: string; readonly reasons: readonly string[] }
export type PlanningIssueSeverity = "blocking" | "degradation" | "information"
export interface PlanningIssue { readonly code: string; readonly severity: PlanningIssueSeverity; readonly phase: PipelinePhaseName; readonly message: string; readonly requirementId?: string; readonly employeeId?: EmployeeId; readonly details?: Readonly<Record<string, string | number>> }
