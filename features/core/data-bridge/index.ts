/**
 * Data Bridge — public API.
 *
 * The ONLY translation layer between the App and the Core. It converts
 * application data (Store module, Employee module, future Leave / Absence
 * modules) into CORE MODELS ONLY, and reports structured mapping errors.
 *
 * It TRANSLATES — nothing else. It never calculates, evaluates, scores or
 * generates, and holds no business logic. Its output, `PlanningInput`, is the
 * clean boundary the Planning Generator consumes:
 *
 *   App data → dataBridge.toPlanningInput() → PlanningInput (core) → Planning Generator
 *
 * The UI must never instantiate core objects directly — all translation passes
 * through here.
 */
export * from "@/features/core/data-bridge/types"
export * from "@/features/core/data-bridge/adapters"
export * from "@/features/core/data-bridge/transformers"
export * from "@/features/core/data-bridge/mappers"
export * from "@/features/core/data-bridge/validators"
export * from "@/features/core/data-bridge/services"
