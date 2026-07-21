import type { CapabilityKey, EmployeeId } from "@/features/core/models"

import type { CoverageWindow } from "@/features/core/demand-engine/models/CoverageWindow"
import type {
  CoverageRequirementId,
  CoverageStatus,
} from "@/features/core/demand-engine/types"

/**
 * CoverageResult — the outcome for one requirement: how it was covered, by whom,
 * and what (if anything) is missing.
 */
export interface CoverageResult {
  readonly requirementId: CoverageRequirementId
  readonly window: CoverageWindow
  readonly status: CoverageStatus
  readonly requiredMin: number
  readonly requiredMax: number | null
  readonly assignedCount: number
  /** Share of the minimum met, in `[0, 1]` (1 = fully met; capped). */
  readonly coveragePercentage: number
  /** Required capabilities not held by any covering employee. */
  readonly missingCapabilities: readonly CapabilityKey[]
  /** Employees counted as covering this window. */
  readonly coveringEmployees: readonly EmployeeId[]
  /** Employees present for only part of the window; never included in assignedCount. */
  readonly partiallyCoveringEmployees: readonly EmployeeId[]
  /** Effective overlap across all employees, including partial presence. */
  readonly coveredEmployeeMinutes: number
  /** Overlap contributed only by employees who do not cover the complete window. */
  readonly partialCoverageMinutes: number
}
