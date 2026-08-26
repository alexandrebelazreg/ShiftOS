"use client"

import Link from "next/link"
import { Store, UsersRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { STEP_EMPLOYEES, useSetupReadiness } from "@/features/onboarding"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

/** Daily action centre: no empty KPI widgets, only the next useful action. */
export function ActionCenter({ store }: { store: StoreConfig | null }) {
  const setup = useSetupReadiness(store)
  // Rien à dire quand tout va bien. La carte « Planning prêt à générer » ne
  // faisait que confirmer l'absence de problème, et occupait la place où l'œil
  // cherche justement ce qui en pose un.
  const actions = setup.isLoading || setup.ready
    ? []
    // La destination est portée par le manque lui-même. Elle se déduisait
    // autrefois en cherchant « employé » dans la phrase, si bien qu'un secteur
    // mal réglé envoyait sur l'écran des salariés dès que son nom contenait le
    // mot — et que reformuler un message changeait silencieusement un lien.
    : setup.blockers.map((blocker) => ({
        title: blocker.message,
        description: blocker.details?.join(" ") ?? "Cette information est nécessaire avant de générer un planning.",
        href: blocker.href,
        action: blocker.step === STEP_EMPLOYEES ? "Ouvrir les employés" : "Compléter la configuration",
        icon: blocker.step === STEP_EMPLOYEES ? UsersRound : Store,
      }))

  /**
   * RIEN À DIRE, RIEN À AFFICHER.
   *
   * Deux blocs occupaient le bas du tableau de bord sans jamais rien apprendre.
   * « Vérification de la configuration… » était censé couvrir le chargement,
   * mais `actions` est vide AUSSI quand tout est en règle : le message
   * s'installait donc à demeure sur un magasin correctement configuré, et
   * annonçait une vérification qui n'avait plus lieu. La phrase de bas de bloc
   * — « Configuration prête » — confirmait l'absence de problème, ce qu'un
   * écran sans alerte dit déjà.
   *
   * Ce qui reste est ce qui appelle un geste : une carte par manque, et rien
   * du tout le reste du temps. La place gagnée sert à voir les plannings et
   * les absences ensemble.
   */
  if (actions.length === 0) return null

  return (
    <div className="space-y-4">
      {actions.map(({ title, description, href, action, icon: Icon }) => (
        <Card key={title}>
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-muted p-2">
                <Icon className="size-5" />
              </div>
              <div>
                <CardTitle className="text-base">{title}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button render={<Link href={href} />}>{action}</Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
