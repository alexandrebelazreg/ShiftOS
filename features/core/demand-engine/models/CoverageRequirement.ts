import type { DemandSegment } from "@/features/core/demand-engine/models/DemandSegment"
import type {
  CoverageRequirementId,
  DemandPriority,
} from "@/features/core/demand-engine/types"

/**
 * CoverageRequirement — an identified, prioritized demand segment. This is what
 * a Demand is made of: "over this window, need at least N (at most M) employees,
 * possibly with these capabilities, at this priority".
 */
export interface CoverageRequirement extends DemandSegment {
  readonly id: CoverageRequirementId
  readonly priority: DemandPriority
}
