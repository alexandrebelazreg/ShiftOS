import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Statistiques" }

export default function StatisticsPage() {
  return <PageHeader title="Statistiques" description="Les statistiques apparaîtront après la création d’un planning." />
}
