import type {
  Assignment,
  Employee,
  Planning,
  Shift,
  Store,
} from "@/features/core/models"

import type { Coverage } from "@/features/core/demand-engine"
import type { StatisticsCalendar } from "@/features/core/statistics-engine/types"

/**
 * StatisticsInput — everything the statistics engine reads. It computes facts
 * from ALREADY-EXISTING data and produces no side effects.
 *
 * - `planning`    — provides identity and the period every figure is scoped to.
 * - `employees`   — the cohort statistics are produced for.
 * - `assignments` / `shifts` — what was actually scheduled.
 * - `store`       — opening hours (opening/closing classification) and identity.
 * - `calendar`    — holidays + absences (holiday / absence counts).
 * - `coverage`    — OPTIONAL demand-engine output. When present it supplies the
 *   coverage rate and gap count; the engine never recomputes coverage.
 */
export interface StatisticsInput {
  readonly planning: Planning
  readonly employees: readonly Employee[]
  readonly assignments: readonly Assignment[]
  readonly shifts: readonly Shift[]
  readonly store: Store
  readonly calendar: StatisticsCalendar
  readonly coverage?: Coverage
}
