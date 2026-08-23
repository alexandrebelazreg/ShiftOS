import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { AbsenceRulesSettings } from "@/features/absences/components/AbsenceRulesSettings"

export const metadata: Metadata = { title: "Paramètres" }

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Paramètres"
        description="Les règles que Planiteo applique, et que votre convention peut contredire."
      />
      <AbsenceRulesSettings />
    </div>
  )
}
