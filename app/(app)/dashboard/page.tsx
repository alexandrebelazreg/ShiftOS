import type { Metadata } from "next"

import { ActionCenter } from "@/components/dashboard/action-center"
import { PageHeader } from "@/components/layout/page-header"
import { getStore } from "@/features/store/services/store.repository"

export const metadata: Metadata = { title: "Tableau de bord" }

export default async function DashboardPage() {
  const store = await getStore()
  return (
    <div className="space-y-8">
      <PageHeader
        title="Tableau de bord"
        description="Retrouvez ici les informations principales de votre espace."
      />

      <ActionCenter store={store} />
    </div>
  )
}
