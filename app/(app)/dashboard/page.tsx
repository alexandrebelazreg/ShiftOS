import type { Metadata } from "next"

import { ActionCenter } from "@/components/dashboard/action-center"
import { PlanningWeekStatusStrip } from "@/components/dashboard/planning-week-status-strip"
import { TeamAbsenceSummary } from "@/components/dashboard/team-absence-summary"
import { PageHeader } from "@/components/layout/page-header"
import { isoDateInTimeZone } from "@/features/planning/dashboard/planning-week-status"
import { getStore } from "@/features/store/services/store.repository"

export const metadata: Metadata = { title: "Tableau de bord" }

export default async function DashboardPage() {
  const store = await getStore()
  const today = isoDateInTimeZone(new Date(), store?.timezone ?? "Europe/Paris")
  return (
    <div className="space-y-8">
      {/* Le titre en tête, comme sur tous les autres écrans : il était sous les
          deux premiers blocs, si bien qu'on lisait le suivi des plannings avant
          de savoir où l'on se trouvait. */}
      <PageHeader
        title="Tableau de bord"
        description="Retrouvez ici les informations principales de votre espace."
      />

      <PlanningWeekStatusStrip today={today} />

      <TeamAbsenceSummary today={today} />

      <ActionCenter store={store} />
    </div>
  )
}
