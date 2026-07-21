import type { DateRange, StoreId } from "@/features/core/models"

import type { CoverageRequirement } from "@/features/core/demand-engine/models/CoverageRequirement"
import type { DemandId } from "@/features/core/demand-engine/types"

/**
 * Demand — a collection of coverage requirements describing the workforce needed
 * for a store over a period.
 *
 * Sector-agnostic: requirements only reference windows, head-counts and generic
 * capabilities — nothing tied to a business domain.
 */
export interface Demand {
  readonly id: DemandId
  readonly storeId?: StoreId
  readonly period?: DateRange
  readonly requirements: readonly CoverageRequirement[]
}
