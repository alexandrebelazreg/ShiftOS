import type { ConstraintRegistry } from "@/features/core/constraint-engine"
import type { FairnessPolicy } from "@/features/core/fairness-engine"
import type { GenerationSettings } from "@/features/core/planning-generator"
import type { ScoringPolicy } from "@/features/core/scoring-engine"

import type { StoreConfiguration } from "@/features/store/models"
import { createStoreConfiguration } from "@/features/store/defaults"
import {
  validateStoreConfiguration,
  type ValidationResult,
} from "@/features/store/validation"
import {
  toConstraintRegistry,
  toFairnessPolicy,
  toGenerationSettings,
  toScoringPolicy,
  type GenerationScope,
} from "@/features/store/mappers"

/**
 * StoreConfigurationService — the single doorway to the store configuration.
 *
 * It creates configurations from the generic defaults, validates unknown input,
 * and ADAPTS a configuration to every engine's own policy type. Because every
 * engine is configured through here, the `StoreConfiguration` is the only place
 * a planning parameter lives — the module owns no business logic, only wiring.
 */
export interface StoreConfigurationService {
  create(overrides?: Partial<StoreConfiguration>): StoreConfiguration
  validate(input: unknown): ValidationResult

  toScoringPolicy(config: StoreConfiguration): ScoringPolicy
  toFairnessPolicy(config: StoreConfiguration): FairnessPolicy
  toConstraintRegistry(config: StoreConfiguration): ConstraintRegistry
  toGenerationSettings(config: StoreConfiguration, scope: GenerationScope): GenerationSettings
}

export const storeConfigurationService: StoreConfigurationService = {
  create: createStoreConfiguration,
  validate: validateStoreConfiguration,
  toScoringPolicy,
  toFairnessPolicy,
  toConstraintRegistry,
  toGenerationSettings,
}
