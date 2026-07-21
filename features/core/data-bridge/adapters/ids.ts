import type {
  AbsenceId,
  AvailabilityRuleId,
  ConstraintId,
  ContractId,
  EmployeeId,
  HolidayId,
} from "@/features/core/models"
import type { CoverageRequirementId, DemandId } from "@/features/core/demand-engine"

/**
 * Id adapters — cast opaque application id strings to the core branded id types.
 * Branding happens ONLY here, at the translation boundary; the rest of the
 * bridge and the core never re-brand.
 */

function brand<T>(value: string): T {
  return value as unknown as T
}

export const toEmployeeId = (id: string): EmployeeId => brand<EmployeeId>(id)
export const toContractId = (employeeId: string): ContractId =>
  brand<ContractId>(`contract_${employeeId}`)
export const toConstraintId = (value: string): ConstraintId => brand<ConstraintId>(value)
export const toAbsenceId = (id: string): AbsenceId => brand<AbsenceId>(id)
export const toAvailabilityRuleId = (id: string): AvailabilityRuleId =>
  brand<AvailabilityRuleId>(id)
export const toHolidayId = (value: string): HolidayId => brand<HolidayId>(value)
export const toDemandId = (id: string): DemandId => brand<DemandId>(id)
export const toCoverageRequirementId = (id: string): CoverageRequirementId =>
  brand<CoverageRequirementId>(id)
