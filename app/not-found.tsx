import Link from "next/link"

import { Button } from "@/components/ui/button"

/**
 * Une adresse qui ne mène nulle part.
 *
 * Posé à la racine pour couvrir aussi ce qui vit hors du groupe `(app)` —
 * la connexion, l'onboarding. Un lien de retour plutôt qu'une impasse : la
 * plupart des 404 de ShiftOS viennent d'un signet vers un planning supprimé,
 * et le gérant cherche alors la liste, pas une explication.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Cette page n’existe pas</h1>
        <p className="text-sm text-muted-foreground">
          L’adresse est peut-être ancienne, ou l’élément qu’elle désignait a été supprimé.
        </p>
        <Button render={<Link href="/dashboard" />}>Retour au tableau de bord</Button>
      </div>
    </main>
  )
}
