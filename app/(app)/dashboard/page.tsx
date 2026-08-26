import type { Metadata } from "next"

import { ActionCenter } from "@/components/dashboard/action-center"
import { PlanningWeekStatusStrip } from "@/components/dashboard/planning-week-status-strip"
import { TeamAbsenceSummary } from "@/components/dashboard/team-absence-summary"
import { isoDateInTimeZone } from "@/features/planning/dashboard/planning-week-status"
import { getStore } from "@/features/store/services/store.repository"

export const metadata: Metadata = { title: "Tableau de bord" }

export default async function DashboardPage() {
  const store = await getStore()
  const today = isoDateInTimeZone(new Date(), store?.timezone ?? "Europe/Paris")
  return (
    /* SUIVI DES PLANNINGS ET ABSENCES DOIVENT TENIR ENSEMBLE À L'ÉCRAN.
       C'est la seule chose qu'on vient chercher ici : ce qui reste à faire
       cette semaine, et qui manque à l'appel. Chaque ligne dépensée plus haut
       repousse la seconde sous la ligne de flottaison, d'où le titre au corps
       du texte et sans sous-titre — « Retrouvez ici les informations
       principales de votre espace » n'apprenait rien à personne. */
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-tight">Tableau de bord</h1>

      <PlanningWeekStatusStrip today={today} />

      <TeamAbsenceSummary today={today} />

      <ActionCenter store={store} />
    </div>
  )
}
