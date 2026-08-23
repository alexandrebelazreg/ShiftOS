import type { Metadata } from "next"

import { verifySession } from "@/features/auth/dal"
import { MigrationView } from "@/features/migration/components/MigrationView"

export const metadata: Metadata = { title: "Reprise des données" }

/**
 * La reprise passe par la session comme tout le reste : elle écrit dans le
 * magasin de celui qui est connecté, et il faut donc qu'il le soit.
 */
export default async function MigrationPage() {
  await verifySession()
  return <MigrationView />
}
