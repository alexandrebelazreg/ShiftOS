/**
 * Statistics Engine — public API.
 *
 * The SINGLE SOURCE OF TRUTH for every planning statistic. A pure, deterministic
 * engine that describes FACTS only — it computes no policy, makes no judgement,
 * and performs no I/O, persistence or UI.
 *
 * It produces, from one consistent snapshot:
 * - `EmployeeStatistics[]` — per-employee facts (hours, days, openings,
 *   closings, splits, weekend/Saturday/Sunday, night, holiday, absence,
 *   coverage contribution);
 * - `PlanningStatistics`    — planning-level roll-up;
 * - `StoreStatistics`       — store-level roll-up.
 *
 * Worked time/days are delegated to the employee engine's `workedHoursCalculator`
 * and coverage rate/gaps to the demand engine's `Coverage` — nothing is
 * recomputed. Consumers (fairness engine, planning generator) read this engine
 * instead of computing their own statistics.
 *
 * Typical use:
 *   const report = statisticsService.compute({ planning, employees, assignments, shifts, store, calendar, coverage })
 *   // just what fairness needs:
 *   const stats = statisticsService.computeEmployeeStatistics(input)
 */
export * from "@/features/core/statistics-engine/types"
export * from "@/features/core/statistics-engine/models"
export * from "@/features/core/statistics-engine/utils"
export * from "@/features/core/statistics-engine/calculators"
export * from "@/features/core/statistics-engine/aggregators"
export * from "@/features/core/statistics-engine/services"
