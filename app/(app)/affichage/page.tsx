import type { Metadata } from "next"

import { PublicationView } from "@/features/planning/publication"
import { getStore } from "@/features/store"

export const metadata: Metadata = { title: "Affichage" }

/**
 * Route Affichage — lit le magasin côté serveur et confie le reste à la vue
 * cliente, qui ne connaît que les plannings publiés.
 */
export default async function AffichagePage() {
  return <PublicationView initialStore={await getStore()} />
}
