import type { BridgeInput, MappingError } from "@/features/core/data-bridge/types"
import { validateStructure } from "@/features/core/data-bridge/validators/structural-validator"
import { validateReferences } from "@/features/core/data-bridge/validators/reference-validator"
import { validateCapabilities } from "@/features/core/data-bridge/validators/capability-validator"
import { validateDates } from "@/features/core/data-bridge/validators/date-validator"

export * from "@/features/core/data-bridge/validators/structural-validator"
export * from "@/features/core/data-bridge/validators/reference-validator"
export * from "@/features/core/data-bridge/validators/capability-validator"
export * from "@/features/core/data-bridge/validators/date-validator"

/**
 * Run every bridge validator and collect all problems in one pass (in a stable
 * order: structure, references, capabilities, dates). Returns an empty array
 * when the payload is fully mappable.
 */
export function validateBridgeInput(input: BridgeInput): MappingError[] {
  return [
    ...validateStructure(input),
    ...validateReferences(input),
    ...validateCapabilities(input),
    ...validateDates(input),
  ]
}
