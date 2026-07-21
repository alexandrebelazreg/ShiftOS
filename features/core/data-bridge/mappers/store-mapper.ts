import type { IsoDateTime, Store } from "@/features/core/models"

import type { StoreInput } from "@/features/core/data-bridge/types"
import { toCoreOpeningHours } from "@/features/core/data-bridge/transformers"

/**
 * Translate the app's store data into the core `Store`. Split-shift settings map
 * to the core `SplitShiftPolicy`: enabled → `allowed` with its break bounds,
 * disabled → `forbidden` with null bounds. No planning logic — pure shape.
 */
export function mapStore(input: StoreInput, now: IsoDateTime): Store {
  const { configuration: config } = input
  const split = config.splitShift

  return {
    id: input.storeId,
    organizationId: input.organizationId,
    name: config.general.name,
    address: input.address ?? "",
    city: input.city ?? "",
    postalCode: input.postalCode ?? "",
    country: config.general.country,
    timezone: config.general.timezone,
    openingHours: toCoreOpeningHours(config),
    planningSettings: {
      mode: config.planning.mode,
      granularity: config.planning.granularity,
      minShiftDuration: config.planning.minShiftDuration,
      maxShiftDuration: config.planning.maxShiftDuration,
    },
    splitShiftPolicy: {
      kind: split.enabled ? "allowed" : "forbidden",
      minSplitDuration: split.enabled ? split.minBreak : null,
      maxSplitDuration: split.enabled ? split.maxBreak : null,
      maxSplitShiftsPerWeek: split.enabled ? split.maxSplitShiftsPerEmployee : null,
    },
    createdAt: now,
    updatedAt: now,
  }
}
