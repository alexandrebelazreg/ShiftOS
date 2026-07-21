import type { CapabilityId } from "@/features/core/models/common"

/**
 * Known capability keys. This list is the built-in set; it is intentionally
 * NOT closed — see `CapabilityKey`.
 */
export const CAPABILITY_KEYS = [
  "CAN_OPEN",
  "CAN_CLOSE",
  "CAN_SPLIT_SHIFT",
  "CAN_WORK_SATURDAY",
] as const
export type KnownCapabilityKey = (typeof CAPABILITY_KEYS)[number]

/**
 * A capability key.
 *
 * `KnownCapabilityKey | (string & {})` is an OPEN union: it keeps editor
 * autocomplete for the known keys while accepting any future key as a plain
 * string. Adding a new capability (e.g. "CAN_WORK_SUNDAY") therefore requires
 * NO change to Employee or any other model — only new data.
 */
export type CapabilityKey = KnownCapabilityKey | (string & {})

/**
 * Capability — a definition/registry entry describing what a capability key
 * means. Employees reference capabilities by key (`Employee.capabilities`), so
 * the capability set is data-driven and extensible.
 *
 * Relationships:
 * - referenced by many Employees (many-to-many via `Employee.capabilities`).
 */
export interface Capability {
  id: CapabilityId
  key: CapabilityKey
  /** Human-readable label, e.g. "Can open the store". */
  label: string
  description?: string
  // TODO: grouping/category if capabilities need to be organized in the UI.
}
