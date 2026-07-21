import type { ConstraintCatalog } from "@/features/core/constraint-catalog/catalog"
import { createConstraintCatalog } from "@/features/core/constraint-catalog/catalog"
import { coreConstraintPack } from "@/features/core/constraint-catalog/metadata"
import type { ConstraintPack } from "@/features/core/constraint-catalog/types"

/**
 * Registers every definition of a pack into a catalog. This is how packs
 * (Retail, Hospital, …) extend ShiftOS without changing the Core.
 */
export function loadPack(
  catalog: ConstraintCatalog,
  pack: ConstraintPack
): void {
  for (const definition of pack.definitions) {
    catalog.registerConstraint(definition)
  }
}

/**
 * Creates a catalog pre-loaded with the built-in Core pack. Additional packs
 * can be `loadPack`-ed on top.
 */
export function createDefaultCatalog(): ConstraintCatalog {
  const catalog = createConstraintCatalog()
  loadPack(catalog, coreConstraintPack)
  return catalog
}
