import type { Metadata } from "next"

import { AbsencesView } from "@/features/absences/components/AbsencesView"
import { getStore } from "@/features/store"

export const metadata: Metadata = { title: "Absences" }

/**
 * Route Absences — lit le magasin côté serveur, comme les permanences : ce sont
 * ses horaires qui disent quels jours du mois sont grisés, et une absence posée
 * un jour de fermeture n'a rien à retirer à personne.
 */
export default async function AbsencePage() {
  return <AbsencesView initialStore={await getStore()} />
}
