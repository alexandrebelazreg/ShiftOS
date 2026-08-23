import type { Metadata } from "next"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LoginForm } from "@/features/auth/components/LoginForm"

export const metadata: Metadata = { title: "Connexion" }

/**
 * Hors du groupe `(app)` : pas de barre latérale, pas d'en-tête, et surtout
 * aucun garde de magasin — c'est la seule page que l'on doit pouvoir atteindre
 * sans session.
 */
export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly suivant?: string | string[] }>
}) {
  const query = await searchParams
  const raw = typeof query.suivant === "string" ? query.suivant : query.suivant?.[0]
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard"

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">ShiftOS</h1>
          <p className="text-sm text-muted-foreground">Planification du personnel</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connexion</CardTitle>
          </CardHeader>
          <CardContent>
            <LoginForm next={next} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
