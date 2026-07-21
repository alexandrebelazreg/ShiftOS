/**
 * Planning V3 — the isolated socle.
 *
 * This module owns an immutable problem model, a pure builder that produces it
 * and an independent validator that audits any solution against it. It contains
 * no solver yet, and nothing here runs in production: the planning the
 * application publishes is still produced by V2 / Sprint 3D.1.
 *
 * Import frontier (enforced by `__tests__/import-boundaries.test.ts`):
 * - allowed: Core models, Core date/time primitives, the V2 *types* the builder
 *   translates from;
 * - forbidden: the V2 business pipeline, the weekly minute allocator, the
 *   weekly placement and repair passes, the V2 candidate-plan validator, and
 *   any React / DOM / storage access.
 */
export * from "@/features/core/planning-v3/types"
export * from "@/features/core/planning-v3/problem-builder"
export * from "@/features/core/planning-v3/validator"
export * from "@/features/core/planning-v3/adapter"
export * from "@/features/core/planning-v3/solver"
export * from "@/features/core/planning-v3/orchestrator/solve-and-validate"
