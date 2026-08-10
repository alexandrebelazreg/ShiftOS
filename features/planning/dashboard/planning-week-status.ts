import type { IsoDate } from "@/features/core/models"
import { listWeekOptions } from "@/features/planning/board"
import type { PlanningSummary } from "@/features/planning/persistence"

export const PLANNING_WEEK_STATES = ["untreated", "saved", "published"] as const
export type PlanningWeekState = (typeof PLANNING_WEEK_STATES)[number]

export interface PlanningWeekStatus {
  readonly weekStart: IsoDate
  readonly weekNumber: number
  readonly offsetLabel: string
  readonly rangeLabel: string
  readonly state: PlanningWeekState
  readonly planningId?: string
}

/** Resolve the store's calendar date without depending on the server's timezone. */
export function isoDateInTimeZone(now: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat("fr-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}` as IsoDate
}

/**
 * Build the dashboard horizon from the current week through S+6.
 *
 * A week can contain several records when a published planning is reopened as
 * a new draft. The most recently updated record is therefore the status the
 * manager needs to see. An archived record is still an existing,
 * saved planning, but it is no longer presented as published.
 */
export function buildPlanningWeekStatuses(
  today: IsoDate,
  plannings: readonly PlanningSummary[],
  weekCount = 7
): PlanningWeekStatus[] {
  const options = listWeekOptions(today, 0, Math.max(0, weekCount - 1))

  return options.map((option, index) => {
    const planning = latestPlanningFor(option.value, plannings)
    const state = planning?.status === "published"
      ? "published"
      : planning
        ? "saved"
        : "untreated"

    return {
      weekStart: option.value,
      weekNumber: option.weekNumber,
      offsetLabel: index === 0 ? "Cette semaine" : `S+${index}`,
      rangeLabel: option.label.replace(/^S\d+ · /, ""),
      state,
      ...(planning ? { planningId: planning.id } : {}),
    }
  })
}

function latestPlanningFor(
  weekStart: IsoDate,
  plannings: readonly PlanningSummary[]
): PlanningSummary | undefined {
  return plannings
    .filter((planning) => planning.periodStart === weekStart)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
}
