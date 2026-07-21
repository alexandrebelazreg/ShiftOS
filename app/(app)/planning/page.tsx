import type { Metadata } from "next"

import { getStore } from "@/features/store"
import { PlanningView } from "@/features/planning"

export const metadata: Metadata = { title: "Planning" }

/**
 * Planning route — a Server Component that reads the onboarding store state and
 * hands it to the client `PlanningView`, which orchestrates generation.
 */
export default async function PlanningPage() {
  const store = await getStore()
  return <PlanningView initialStore={store} />
}
