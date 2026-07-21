import type { StoreId } from "@/features/core/models"

import type { StoreConfigurationId } from "@/features/store/types/configuration.types"
import type { GeneralInformation } from "@/features/store/models/general-information"
import type { OpeningHours } from "@/features/store/models/opening-hours"
import type { PlanningSettings } from "@/features/store/models/planning-settings"
import type { ShiftSettings } from "@/features/store/models/shift-settings"
import type { SplitShiftSettings } from "@/features/store/models/split-shift-settings"
import type { CoverageSettings } from "@/features/store/models/coverage-settings"
import type { FairnessSettings } from "@/features/store/models/fairness-settings"
import type { ScoringSettings } from "@/features/store/models/scoring-settings"
import type { HolidaySettings } from "@/features/store/models/holiday-settings"
import type { CapabilitySettings } from "@/features/store/models/capability-settings"

/**
 * StoreConfiguration — the SINGLE SOURCE OF TRUTH for every planning parameter.
 *
 * It holds configuration only — VALUES, never business logic. The engines are
 * configured FROM it (via the mappers), so no parameter lives in two places.
 * One `StoreConfiguration` fully determines how a store's plannings are
 * generated, constrained, scored and measured for fairness.
 */
export interface StoreConfiguration {
  readonly id: StoreConfigurationId
  readonly storeId: StoreId

  readonly general: GeneralInformation
  readonly openingHours: OpeningHours
  readonly planning: PlanningSettings
  readonly shift: ShiftSettings
  readonly splitShift: SplitShiftSettings
  readonly coverage: CoverageSettings
  readonly fairness: FairnessSettings
  readonly scoring: ScoringSettings
  readonly holidays: HolidaySettings
  readonly capabilities: CapabilitySettings
}
