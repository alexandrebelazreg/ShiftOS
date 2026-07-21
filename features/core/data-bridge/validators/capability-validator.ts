import type { CapabilityKey } from "@/features/core/models"
import { CAPABILITY_KEYS } from "@/features/core/models"

import type { BridgeInput, MappingError } from "@/features/core/data-bridge/types"

/**
 * Detect UNKNOWN CAPABILITIES: capabilities required by demand that are neither
 * a core built-in key nor defined in the store's capability catalogue. Pure set
 * membership — the bridge does not decide whether an employee HAS a capability,
 * only whether the referenced capability EXISTS.
 */
export function validateCapabilities(input: BridgeInput): MappingError[] {
  const errors: MappingError[] = []
  if (!input.demand) return errors

  const known = new Set<CapabilityKey>([
    ...CAPABILITY_KEYS,
    ...input.store.configuration.capabilities.definitions.map((d) => d.key),
  ])

  input.demand.requirements.forEach((requirement, index) => {
    requirement.requiredCapabilities?.forEach((capability, capIndex) => {
      if (!known.has(capability)) {
        errors.push({
          code: "unknown_capability",
          path: `demand.requirements[${index}].requiredCapabilities[${capIndex}]`,
          message: `Unknown capability "${capability}"`,
          entity: "demand",
          id: requirement.id,
        })
      }
    })
  })

  return errors
}
