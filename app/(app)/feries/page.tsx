import type { Metadata } from "next"

import { HolidaysView } from "@/features/planning/holidays"
import { getStore } from "@/features/store"

export const metadata: Metadata = { title: "Jours fériés" }

/**
 * Route Jours fériés — lit le magasin côté serveur pour proposer ses horaires
 * habituels, et confie le reste à la vue cliente.
 */
export default async function FeriesPage() {
  return <HolidaysView initialStore={await getStore()} />
}
