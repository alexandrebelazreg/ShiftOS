"use client"

import { useEffect } from "react"

import { Button } from "@/components/ui/button"

/**
 * Ce qu'un écran montre quand il tombe.
 *
 * Sans ce fichier, une erreur non rattrapée emportait l'application entière :
 * page blanche, aucune explication, et pour seul recours de recharger — ce qui
 * fait perdre ce qui n'était pas enregistré. Le manque datait de l'audit du
 * 19 août, et il est devenu réel le jour où les données sont parties en base :
 * une requête qui échoue traverse désormais tout l'arbre.
 *
 * Il est posé dans le groupe `(app)` et non à la racine : la barre latérale et
 * l'en-tête SURVIVENT, donc le gérant garde de quoi partir ailleurs plutôt que
 * de se retrouver face à un mur. Seul le contenu de l'écran est remplacé.
 *
 * `unstable_retry` et non `reset` : Next 16 les distingue. `reset` se contente
 * de vider l'état d'erreur et de rendre à nouveau les enfants — si la cause est
 * une requête qui a échoué, elle échoue aussitôt. `unstable_retry` REFAIT la
 * récupération, ce qui est exactement ce qu'on veut après une coupure de réseau.
 */
export default function AppError({
  error,
  unstable_retry,
}: {
  readonly error: Error & { digest?: string }
  readonly unstable_retry: () => void
}) {
  useEffect(() => {
    // Journalisé côté navigateur en attendant un service de collecte. Le
    // `digest` est la seule prise sur l'erreur réelle en production, où le
    // message est masqué : sans lui, un rapport d'incident ne mène nulle part.
    console.error("Planiteo — écran en erreur", error.digest ?? "", error)
  }, [error])

  return (
    <div className="mx-auto max-w-lg space-y-4 py-12">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Cet écran n’a pas pu s’afficher</h1>
        <p className="text-sm text-muted-foreground">
          Le reste de Planiteo fonctionne : vous pouvez réessayer, ou passer à un autre écran par
          le menu. Rien de ce qui était enregistré n’est perdu.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => unstable_retry()}>Réessayer</Button>
        <Button variant="outline" onClick={() => window.location.assign("/dashboard")}>
          Retour au tableau de bord
        </Button>
      </div>

      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          Référence à donner en cas de signalement : {error.digest}
        </p>
      ) : null}
    </div>
  )
}
