import type { Planning, StoreId } from "@/features/core/models"

import type { GenerationSettings } from "@/features/core/planning-generator/types"

/**
 * Build the empty draft planning the strategy will populate. It carries only
 * identity, scope and provenance — no assignments yet. Timestamps come from
 * `settings.now` so the result is deterministic.
 */
export function buildEmptyPlanning(
  storeId: StoreId,
  settings: GenerationSettings
): Planning {
  return {
    id: settings.planningId,
    storeId,
    status: "draft",
    periodStart: settings.period.start,
    periodEnd: settings.period.end,
    generatedWith: settings.mode,
    createdAt: settings.now,
    updatedAt: settings.now,
  }
}
