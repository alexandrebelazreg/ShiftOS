import type { z } from "zod"

import type { MappingError } from "@/features/core/data-bridge"

/**
 * FlowError — a single, uniform error the Planning page can render, regardless
 * of which stage produced it (configuration validation or data-bridge mapping).
 * A flat, presentation-friendly shape; no logic.
 */
export interface FlowError {
  readonly code: string
  readonly path: string
  readonly message: string
}

/** Normalize data-bridge mapping errors to `FlowError`. */
export function fromMappingErrors(errors: readonly MappingError[]): FlowError[] {
  return errors.map((error) => ({
    code: error.code,
    path: error.path,
    message: error.message,
  }))
}

/** Normalize a Zod validation error (store configuration) to `FlowError`. */
export function fromZodError(error: z.ZodError): FlowError[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    path: issue.path.join("."),
    message: issue.message,
  }))
}
