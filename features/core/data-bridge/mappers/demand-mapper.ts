import type { StoreId } from "@/features/core/models"
import type {
  CoverageRequirement,
  Demand,
  DemandPriority,
} from "@/features/core/demand-engine"

import type { DemandInput } from "@/features/core/data-bridge/types"
import {
  toCoverageRequirementId,
  toDemandId,
} from "@/features/core/data-bridge/adapters"

/**
 * Translate the app's demand DTO into the core `Demand`. Each requirement's
 * date + time window becomes a `CoverageWindow`; priority defaults to `medium`.
 * Pure shape translation — the bridge does not compute coverage.
 */
export function mapDemand(input: DemandInput, storeId: StoreId): Demand {
  const requirements: CoverageRequirement[] = input.requirements.map((r) => ({
    id: toCoverageRequirementId(r.id),
    priority: (r.priority as DemandPriority | undefined) ?? "medium",
    window: {
      date: r.date,
      start: r.start,
      end: r.end,
      endDayOffset: r.endDayOffset,
    },
    minEmployees: r.minEmployees,
    maxEmployees: r.maxEmployees ?? null,
    requiredCapabilities: r.requiredCapabilities,
  }))

  return {
    id: toDemandId(input.id),
    storeId,
    requirements,
  }
}
