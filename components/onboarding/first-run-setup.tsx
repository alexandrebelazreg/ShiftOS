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
import { evaluateSetupReadiness, type SetupSector } from "@/features/onboarding/setup-readiness"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { activeCompetencyNames, createEmptySector } from "@/features/sectors"

const STEPS = ["Magasin", "Secteurs", "Employés", "Compétences", "Contraintes", "Premier planning"]

/** The guided first-run screen shown after the store configuration is saved. */
export function FirstRunSetup({ store }: { store: StoreConfig }) {
  const { employees, isLoading } = useEmployees()
  const [sectors, setSectors] = useState<readonly SetupSector[]>([])
  const [sectorName, setSectorName] = useState("")
  const [skills, setSkills] = useState("")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    queueMicrotask(() => setSectors(createSetupRepository(window.localStorage).listSectors()))
  }, [])

  const readiness = useMemo(
    () => evaluateSetupReadiness({ store, employees, sectors }),
    [store, employees, sectors]
  )
  const blockers = readiness.blockers
  const isReady = readiness.ready && !isLoading
  const current = isReady ? 6 : sectors.length === 0 ? 2 : employees.length === 0 ? 3 : 4

  function addSector() {
    const name = sectorName.trim()
    if (!name) return
    const next = [
      ...sectors,
      { ...createEmptySector(), name, competencies: skills.split(",").map((skill) => skill.trim()).filter(Boolean).map((skill, order) => ({ id: `competency_${crypto.randomUUID()}`, name: skill, archived: false, order })) },
    ]
    createSetupRepository(window.localStorage).saveSectors(next)
    setSectors(next)
    setSectorName("")
    setSkills("")
  }

  return (
    <main className="min-h-svh bg-muted/30">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 md:py-16">
        <StepProgress current={current} total={STEPS.length} labels={STEPS} />
        <header className="mt-8 mb-8 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Préparons votre premier planning</h1>
          <p className="text-muted-foreground">Suivez ces étapes : ShiftOS vérifiera que tout est prêt avant la génération.</p>
        </header>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">2. Secteurs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Créez les zones à couvrir et une compétence requise pour chacune.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={sectorName} onChange={(event) => setSectorName(event.target.value)} placeholder="Ex. Caisse" aria-label="Nom du secteur" />
                <Input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="Ex. Encaissement" aria-label="Compétences requises" />
              </div>
              <Button type="button" variant="outline" onClick={addSector}><Plus />Créer un secteur</Button>
              {sectors.length > 0 ? <ul className="space-y-1 text-sm">{sectors.map((sector) => <li key={sector.id}><Check className="mr-2 inline size-4 text-primary" />{sector.name} — {activeCompetencyNames(sector).join(", ") || "compétences facultatives"}</li>)}</ul> : null}
            </CardContent>
          </Card>

          <SetupAction title="3. Employés" description={`${employees.length} employé${employees.length > 1 ? "s" : ""} configuré${employees.length > 1 ? "s" : ""}.`} href="/configuration/employes" action="Gérer les employés" />
          <SetupAction title="4. Compétences" description="Renseignez les capacités d’ouverture, de fermeture et de coupure sur chaque profil." href="/configuration/employes" action="Configurer les compétences" />
          <SetupAction title="5. Contraintes" description="Ajoutez les repos fixes et les contraintes de chaque employé." href="/configuration/employes" action="Configurer les contraintes" />

          {blockers.length > 0 ? <Card><CardContent className="py-4"><p className="text-sm font-medium">Il reste quelques éléments à compléter :</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></CardContent></Card> : null}

          <Button className="w-full" disabled={!isReady || isPending} onClick={() => startTransition(() => { void completeFirstRun() })}>
            {isPending ? "Finalisation…" : "Générer mon premier planning"}
          </Button>
        </div>
      </div>
    </main>
  )
}

function SetupAction({ title, description, href, action }: { title: string; description: string; href: string; action: string }) {
  return <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-medium">{title}</p><p className="text-sm text-muted-foreground">{description}</p></div><Button variant="outline" render={<Link href={href} />}>{action}</Button></CardContent></Card>
}
