import type { Metadata } from "next"

import { PaidLeavePlanningView } from "@/features/paid-leave/components/paid-leave-planning-view"
import { getStore } from "@/features/store"

export const metadata: Metadata = { title: "Congés payés" }

export default async function PaidLeavePage() {
  // Le magasin est lu ici, côté serveur : la feuille affichée au mur porte son
  // nom en en-tête, et la vue cliente ne possède aucun accès au cookie.
  return <PaidLeavePlanningView initialStore={await getStore()} />
}
