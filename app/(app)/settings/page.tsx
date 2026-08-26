import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"
import { ProfileNameForm } from "@/features/auth/components/profile-name-form"
import { verifySession } from "@/features/auth/dal"

export const metadata: Metadata = { title: "Paramètres" }

/**
 * Paramètres — pour l'instant, le seul réglage qui appartient à la PERSONNE et
 * non au magasin : son nom.
 *
 * Tout le reste — horaires, rayons, équipe — vit dans le parcours de
 * configuration, parce que tout le reste est vrai pour quiconque ouvre ce
 * magasin. Le nom, lui, change avec celui qui est connecté.
 */
export default async function SettingsPage() {
  const session = await verifySession()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paramètres"
        description="Ce qui vous appartient, à vous et non au magasin."
      />
      <ProfileNameForm initialName={session.fullName ?? ""} email={session.email} />
    </div>
  )
}
