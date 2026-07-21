import type { z } from "zod"

import type { StoreConfiguration } from "@/features/store/models"
import { storeConfigurationSchema } from "@/features/store/validation/store-configuration.schema"

/** Outcome of validating an unknown value against the configuration schema. */
export type ValidationResult =
  | { readonly success: true; readonly data: StoreConfiguration }
  | { readonly success: false; readonly error: z.ZodError }

/**
 * Validate an unknown value as a `StoreConfiguration`. The single entry point
 * for configuration validation — callers never re-implement any rule.
 */
export function validateStoreConfiguration(input: unknown): ValidationResult {
  const result = storeConfigurationSchema.safeParse(input)
  if (result.success) {
    // The schema mirrors the model; brands are erased at the validation boundary.
    return { success: true, data: result.data as unknown as StoreConfiguration }
  }
  return { success: false, error: result.error }
}
