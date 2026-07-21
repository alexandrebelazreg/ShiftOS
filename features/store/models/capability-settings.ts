import type { CapabilityKey } from "@/features/core/models"

/**
 * CapabilityDefinition — one capability the store recognizes (e.g. `CAN_OPEN`).
 * The key is the core `CapabilityKey`; label/description are for display.
 */
export interface CapabilityDefinition {
  readonly key: CapabilityKey
  readonly label: string
  readonly description?: string
}

/**
 * CapabilitySettings — the store's capability catalogue. Open set: adding a
 * capability is adding an entry, no code change.
 */
export interface CapabilitySettings {
  readonly definitions: readonly CapabilityDefinition[]
}
