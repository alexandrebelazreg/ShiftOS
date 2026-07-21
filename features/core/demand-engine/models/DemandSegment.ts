import type { CapabilityKey } from "@/features/core/models"

import type { CoverageWindow } from "@/features/core/demand-engine/models/CoverageWindow"

/**
 * DemandSegment — the atomic unit of workforce demand: how many people (and,
 * optionally, with which capabilities) are needed over one window.
 *
 * A `CoverageRequirement` is a DemandSegment elevated with an identity and a
 * priority.
 */
export interface DemandSegment {
  readonly window: CoverageWindow
  /** Minimum employees needed in the window. */
  readonly minEmployees: number
  /** Maximum employees wanted in the window; `null`/omitted means no ceiling. */
  readonly maxEmployees?: number | null
  /** Capabilities that must be present among the covering employees. */
  readonly requiredCapabilities?: readonly CapabilityKey[]
}
