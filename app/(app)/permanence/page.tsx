import type { Metadata } from "next"

import { PermanenceView } from "@/features/permanence"
import { getStore } from "@/features/store"

export const metadata: Metadata = { title: "Permanences" }

/**
 * Route Permanences — lit le magasin côté serveur, parce que ce sont ses
 * horaires qui décident des journées à pourvoir, et notamment de l'existence
 * d'une colonne « dimanche ».
 */
export default async function PermanencePage() {
  return <PermanenceView initialStore={await getStore()} />
}
