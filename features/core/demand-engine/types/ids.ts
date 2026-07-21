import type { Brand } from "@/features/core/models"

/** Identifier of a whole demand (a set of requirements). */
export type DemandId = Brand<string, "DemandId">
/** Identifier of a single coverage requirement within a demand. */
export type CoverageRequirementId = Brand<string, "CoverageRequirementId">
