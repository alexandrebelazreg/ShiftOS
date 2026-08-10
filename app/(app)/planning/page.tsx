import type { Metadata } from "next"

import { isValidIsoDate } from "@/features/core/shared"
import { mondayOf } from "@/features/planning/board"
import { getStore } from "@/features/store"
import { PlanningView } from "@/features/planning"

export const metadata: Metadata = { title: "Planning" }

/**
 * Planning route — a Server Component that reads the onboarding store state and
 * hands it to the client `PlanningView`, which orchestrates generation.
 */
export default async function PlanningPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly week?: string | string[]
    readonly planningId?: string | string[]
  }>
}) {
  const store = await getStore()
  const query = await searchParams
  const requestedWeek = singleValue(query.week)
  const initialWeek = requestedWeek && isValidIsoDate(requestedWeek)
    ? mondayOf(requestedWeek)
    : undefined

  return (
    <PlanningView
      initialStore={store}
      initialWeek={initialWeek}
      initialPlanningId={singleValue(query.planningId)}
    />
  )
}

function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0]
}
