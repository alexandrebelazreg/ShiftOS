import type { CoverageGap } from "@/features/core/demand-engine/models/CoverageGap"
import type { CoverageResult } from "@/features/core/demand-engine/models/CoverageResult"
import type { CoverageStatistics } from "@/features/core/demand-engine/models/CoverageStatistics"
import type { DemandId } from "@/features/core/demand-engine/types"

/**
 * Coverage — the full comparison of a demand against a set of assignments:
 * a per-requirement result, the aggregate statistics, and the list of gaps.
 */
export interface Coverage {
  readonly demandId: DemandId
  readonly results: readonly CoverageResult[]
  readonly gaps: readonly CoverageGap[]
  readonly statistics: CoverageStatistics
}
