import type { Metadata } from "next"

import { PaidLeavePlanningView } from "@/features/paid-leave/components/paid-leave-planning-view"

export const metadata: Metadata = { title: "Congés payés" }

export default function PaidLeavePage() {
  return <PaidLeavePlanningView />
}
