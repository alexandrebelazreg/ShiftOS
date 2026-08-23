"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, useTransition } from "react"
import { Check, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { StepProgress } from "@/components/onboarding/step-progress"
import { completeFirstRun } from "@/features/store/services/onboarding.actions"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { createSetupRepository } from "@/features/onboarding/setup-repository"
import {
  currentSetupStep,
  evaluateSetupReadiness,
  SETUP_STEPS,
  type SetupBlocker,
  type SetupSector,
} from "@/features/onboarding/setup-readiness"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { activeCompetencyNames, createEmptySector } from "@/features/sectors"

/** The guided first-run screen shown after the store configuration is saved. */
export function FirstRunSetup({ store }: { store: StoreConfig }) {
  const { employees, isLoading } = useEmployees()
  const [sectors, setSectors] = useState<readonly SetupSector[]>([])
  const [sectorName, setSectorName] = useState("")
  const [skills, setSkills] = useState("")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    queueMicrotask(() => { void createSetupRepository().listSectors().then(setSectors) })
  }, [])

  const readiness = useMemo(
    () => evaluateSetupReadiness({ store, employees, sectors }),
    [store, employees, sectors]
  )
  const blockers = readiness.blockers
  const isReady = readiness.ready && !isLoading
  // Tant que l'équipe se charge, le verdict est incomplet : afficher la
  // dernière étape à ce moment-là ferait clignoter « prêt » puis reculer.
  const current = isLoading ? 1 : currentSetupStep(readiness)

  const openDays = store.openingHours.filter((day) => !day.closed).length
  const activeEmployees = employees.filter((employee) => employee.status === "active").length

  function addSector() {
    const name = sectorName.trim()
    if (!name) return
    const next = [
      ...sectors,
      { ...createEmptySector(), name, competencies: skills.split(",").map((skill) => skill.trim()).filter(Boolean).map((skill, order) => ({ id: `competency_${crypto.randomUUID()}`, name: skill, archived: false, order })) },
    ]
    createSetupRepository().saveSectors(next)
    setSectors(next)
    setSectorName("")
    setSkills("")
  }

  return (
    <main className="min-h-svh bg-muted/30">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 md:py-16">
        <StepProgress current={current} total={SETUP_STEPS.length} labels={SETUP_STEPS.map((step) => step.label)} />
        <header className="mt-8 mb-8 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Préparons votre premier planning</h1>
          <p className="text-muted-foreground">Suivez ces étapes : Planiteo vérifiera que tout est prêt avant la génération.</p>
        </header>

        <div className="space-y-4">
          {/* L'étape 1 manquait à cet écran : le fil d'avancement l'annonçait,
              aucune carte ne la portait, et un magasin incomplet se signalait
              sans offrir où le compléter. */}
          <SetupAction
            title="1. Magasin"
            description={`${store.name} — ${openDays} jour${openDays > 1 ? "s" : ""} d’ouverture par semaine.`}
            href={SETUP_STEPS[0].href}
            action="Modifier le magasin"
          />

          <Card>
            <CardHeader><CardTitle className="text-base">2. Secteurs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Créez les zones à couvrir et une compétence requise pour chacune.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={sectorName} onChange={(event) => setSectorName(event.target.value)} placeholder="Ex. Caisse" aria-label="Nom du secteur" />
                <Input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Ex. Encaissement" aria-label="Compétences requises" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={addSector}><Plus />Créer un secteur</Button>
                {sectors.length > 0 ? <Button type="button" variant="ghost" render={<Link href={SETUP_STEPS[1].href} />}>Régler la demande</Button> : null}
              </div>
              {sectors.length > 0 ? <ul className="space-y-1 text-sm">{sectors.map((sector) => <li key={sector.id}><Check className="mr-2 inline size-4 text-primary" />{sector.name} — {activeCompetencyNames(sector).join(", ") || "compétences facultatives"}</li>)}</ul> : null}
            </CardContent>
          </Card>

          <SetupAction title="3. Employés" description={`${activeEmployees} employé${activeEmployees > 1 ? "s" : ""} actif${activeEmployees > 1 ? "s" : ""}.`} href={SETUP_STEPS[2].href} action="Gérer les employés" />
          <SetupAction title="4. Compétences" description="Renseignez les capacités d’ouverture, de fermeture et de coupure sur chaque profil." href={SETUP_STEPS[3].href} action="Configurer les compétences" optional />
          <SetupAction title="5. Contraintes" description="Ajoutez les repos fixes et les contraintes de chaque employé." href={SETUP_STEPS[4].href} action="Configurer les contraintes" optional />

          {blockers.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 py-4">
                <p className="text-sm font-medium">Il reste {blockers.length} élément{blockers.length > 1 ? "s" : ""} à compléter :</p>
                <ul className="space-y-3">
                  {blockers.map((blocker) => <BlockerRow key={`${blocker.step}-${blocker.message}`} blocker={blocker} />)}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Button className="w-full" disabled={!isReady || isPending} onClick={() => startTransition(() => { void completeFirstRun() })}>
            {isPending ? "Finalisation…" : "Générer mon premier planning"}
          </Button>
        </div>
      </div>
    </main>
  )
}

/**
 * Un manque, et le chemin pour le lever.
 *
 * Le détail est montré tel que le validateur du secteur l'a écrit : c'est lui
 * qui sait quel champ est refusé et pourquoi. Il était calculé puis jeté, et le
 * gérant lisait à la place une phrase générique répétée autant de fois qu'il
 * avait de secteurs.
 */
function BlockerRow({ blocker }: { blocker: SetupBlocker }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b pb-3 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm">{blocker.message}</p>
        {blocker.details && blocker.details.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {blocker.details.map((detail) => <li key={detail}>{detail}</li>)}
          </ul>
        ) : null}
      </div>
      <Button size="sm" variant="outline" render={<Link href={blocker.href} />}>Corriger</Button>
    </li>
  )
}

function SetupAction({ title, description, href, action, optional = false }: { title: string; description: string; href: string; action: string; optional?: boolean }) {
  return <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-medium">{title}{optional ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">facultatif</span> : null}</p><p className="text-sm text-muted-foreground">{description}</p></div><Button variant="outline" render={<Link href={href} />}>{action}</Button></CardContent></Card>
}
