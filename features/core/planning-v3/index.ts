/**
 * Planning V3 — the isolated socle.
 *
 * This module owns an immutable problem model, a pure builder that produces it,
 * the closing-fairness comparison and an independent validator that audits any
 * solution against it.
 *
 * It contains NO solver. The one engine, `v3-highs-fast`, lives in Python
 * behind the solve contract's adapter — which is the point: the socle can be
 * imported by anything, including the browser, without dragging a search
 * engine or a subprocess in.
 *
 * Import frontier (enforced by `__tests__/import-boundaries.test.ts`):
 * - allowed: Core models, Core date/time primitives, the generation *types* the
 *   builder translates from;
 * - forbidden: any React / DOM / storage access.
 */
export * from "@/features/core/planning-v3/types"
export * from "@/features/core/planning-v3/problem-builder"
export * from "@/features/core/planning-v3/validator"
export * from "@/features/core/planning-v3/adapter"
export * from "@/features/core/planning-v3/fairness/closing-load"
