import type { Absence, Holiday } from "@/features/core/models"

/**
 * StatisticsCalendar — the temporal facts the statistics engine reads to
 * classify worked days: store holidays and employee absences over the period.
 *
 * It is the "Calendar" input. It carries only facts (dated holidays, dated
 * absence ranges); the engine draws no policy from them — it merely counts.
 */
export interface StatisticsCalendar {
  readonly holidays: readonly Holiday[]
  readonly absences: readonly Absence[]
}
