import type { CapabilityKey } from "@/features/core/models"

import type { CoverageWindow } from "@/features/core/demand-engine/models/CoverageWindow"
import type { CoverageRequirementId } from "@/features/core/demand-engine/types"

/**
 * CoverageGap — an unmet part of a requirement: missing head-count and/or
 * missing capabilities. This is the shortfall a future generator would try to
 * fill (the demand model only reports it — it does not resolve it).
 */
export interface CoverageGap {
  readonly requirementId: CoverageRequirementId
  readonly window: CoverageWindow
  /** How many more employees are needed to reach the minimum (0 if met). */
  readonly missingEmployees: number
  /** Required capabilities not present among the covering employees. */
  readonly missingCapabilities: readonly CapabilityKey[]
}
