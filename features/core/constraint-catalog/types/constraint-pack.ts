import type { ConstraintDefinition } from "@/features/core/constraint-catalog/types/constraint-definition"

/**
 * A pack bundles a set of constraint definitions that are registered together.
 *
 * This is the extensibility unit: a "Retail Pack" or "Hospital Pack" ships its
 * own definitions and registers them into the catalog — the Core never changes.
 */
export interface ConstraintPack {
  readonly name: string
  readonly version: string
  readonly definitions: readonly ConstraintDefinition[]
}
