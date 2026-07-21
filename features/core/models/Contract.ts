import type {
  ContractId,
  EmployeeId,
  Timestamps,
  WeekDay,
} from "@/features/core/models/common"

/** Employment contract type. */
export const CONTRACT_TYPES = ["full_time", "part_time"] as const
export type ContractType = (typeof CONTRACT_TYPES)[number]

/**
 * Contract — the working-time agreement for a single employee.
 *
 * Relationships:
 * - belongs to one Employee (`employeeId`, one-to-one).
 *
 * Fields limited to what the domain currently defines (weekly hours, working
 * days, daily bounds, type). Daily bounds here are the per-employee values;
 * store-wide baselines live in PlanningRule.
 */
export interface Contract extends Timestamps {
  id: ContractId
  employeeId: EmployeeId

  contractType: ContractType
  /** Exact contracted duration. Integer minutes are the planning source of truth. */
  weeklyMinutes?: number
  /** @deprecated Compatibility projection for legacy records and frozen engines. */
  weeklyHours: number
  /** Days the employee is contracted to work. */
  workingDays: WeekDay[]
  /** Minimum hours in a single working day. */
  minDailyHours: number
  /** Maximum hours in a single working day. */
  maxDailyHours: number

  // TODO: effective period (startDate / endDate) once the domain requires it.
}

/** Normalize legacy decimal-hour contracts once at the domain boundary. */
export function contractualMinutes(contract: Pick<Contract, "weeklyMinutes" | "weeklyHours">): number {
  return contract.weeklyMinutes ?? Math.round(contract.weeklyHours * 60)
}
