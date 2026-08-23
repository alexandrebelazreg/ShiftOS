import type { Metadata } from "next"
import Link from "next/link"

import { verifySession } from "@/features/auth/dal"
import { MigrationView } from "@/features/migration/components/MigrationView"

export const metadata: Metadata = { title: "Reprise des données" }

/**
 * HORS du groupe `(app)`, et c'est le sujet.
 *
 * Le garde de ce groupe exige un magasin CONFIGURÉ et renvoie vers l'onboarding
 * quand il n'en trouve pas. Or c'est précisément ce que la reprise vient
 * apporter : la page se trouvait derrière la porte qu'elle sert à ouvrir, et
 * l'impasse était fermée — on ne pouvait jamais l'atteindre.
 *
 * Elle exige une session, et rien d'autre. Elle écrit dans le magasin de celui
 * qui est connecté ; il n'a pas besoin d'être complet pour recevoir.
 */
export default async function MigrationPage() {
  await verifySession()
  // Hors de l'AppShell, la page n'a ni barre latérale ni marges : elle porte
  // les siennes. Un lien de sortie plutôt qu'une navigation complète — on ne
  // vient ici qu'une fois, et ce qu'on veut ensuite est entrer dans Planiteo.
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <MigrationView />
      <p className="mt-8 text-sm text-muted-foreground">
        Une fois la copie terminée,{" "}
        <Link href="/dashboard" className="underline underline-offset-4">
          rejoignez le tableau de bord
        </Link>
        .
      </p>
    </main>
  )
}
