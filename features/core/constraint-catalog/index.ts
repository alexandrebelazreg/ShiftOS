/**
 * Constraint Catalog — the official source of every constraint available in
 * ShiftOS.
 *
 * Constraints are declared as `ConstraintDefinition`s (metadata + parameters +
 * factory), bundled into packs, and registered into a catalog. The Planning
 * Engine never imports a business constraint directly — it goes through:
 *
 *   createDefaultCatalog()            // or a custom catalog + loadPack(...)
 *     → buildRegistry(catalog)        // Catalog → Registry
 *       → constraintEvaluator.evaluate(registry, context)   // → Evaluator
 */
export * from "@/features/core/constraint-catalog/types"
export * from "@/features/core/constraint-catalog/utils"
export * from "@/features/core/constraint-catalog/metadata"
export * from "@/features/core/constraint-catalog/catalog"
export * from "@/features/core/constraint-catalog/loader"
export * from "@/features/core/constraint-catalog/registry"
