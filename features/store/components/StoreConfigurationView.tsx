"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { createSetupRepository } from "@/features/onboarding/setup-repository"
import { evaluateSetupReadiness, type SetupSector } from "@/features/onboarding/setup-readiness"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { StoreForm } from "@/features/store/components/StoreForm"

/** Readable, non-empty summary of the persisted store configuration. */
export function StoreConfigurationView({ store }: { store: StoreConfig }) {
  const router = useRouter()
  const { employees } = useEmployees()
  const [sectors, setSectors] = useState<readonly SetupSector[]>([])
  const [isEditing, setIsEditing] = useState(false)
  useEffect(() => queueMicrotask(() => setSectors(createSetupRepository(window.localStorage).listSectors())), [])
  const openDays = store.openingHours.filter((day) => !day.closed)
  const readiness = evaluateSetupReadiness({ store, employees, sectors })
  const completion = Math.round((1 - readiness.blockers.length / 4) * 100)

  if (isEditing) return <div className="space-y-6"><PageHeader title="Modifier le magasin" description="Modifiez les informations, horaires et règles de planification." /><StoreForm initialStore={store} onSaved={() => { setIsEditing(false); router.refresh() }} /></div>
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><PageHeader title="Configuration du magasin" description="Les paramètres utilisés pour préparer vos plannings." /><Button onClick={() => setIsEditing(true)}>Modifier la configuration</Button></div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Summary title="Employés" value={String(employees.length)} />
      <Summary title="Secteurs" value={String(sectors.length)} />
      <Summary title="Dernière mise à jour" value="Configuration enregistrée" />
    </div>
    <Card><CardHeader><CardTitle className="text-base">Avancement de la configuration — {completion}%</CardTitle></CardHeader><CardContent className="space-y-3"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${completion}%` }} /></div>{readiness.blockers.length > 0 ? <><p className="text-sm text-muted-foreground">Éléments à compléter :</p><ul className="list-disc space-y-1 pl-5 text-sm">{readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" render={<Link href="/configuration/secteurs" />}>Créer le premier secteur</Button><Button size="sm" variant="outline" render={<Link href="/configuration/employes" />}>Créer le premier employé</Button></div></> : <p className="text-sm text-muted-foreground">Le magasin est prêt pour les opérations quotidiennes.</p>}</CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Informations générales"><Definition label="Nom du magasin" value={store.name} /><Definition label="Enseigne" value={store.brand || "À renseigner"} /><Definition label="Adresse" value={`${store.address}, ${store.postalCode} ${store.city}`} /></Section>
      <Section title="Horaires d’ouverture">{openDays.length === 0 ? <p className="text-sm text-muted-foreground">Aucun horaire d’ouverture renseigné.</p> : <ul className="space-y-1 text-sm">{openDays.map((day) => <li key={day.day} className="flex justify-between gap-3"><span className="capitalize">{day.day}</span><span>{day.opensAt} – {day.closesAt}</span></li>)}</ul>}</Section>
      <Section title="Configuration du magasin"><Definition label="Pays" value={store.country} /><Definition label="Fuseau horaire" value={store.timezone} /></Section>
      <Section title="Paramètres métier"><Definition label="Durée minimale quotidienne" value={`${store.minDailyHours} h`} /><Definition label="Repos entre deux services" value={`${store.minRestBetweenShifts} h`} /></Section>
      <Section title="Paramètres de planning"><Definition label="Mode" value={store.planningMode === "dynamic" ? "Dynamique" : "Bibliothèque de services"} /><Definition label="Granularité" value={store.timeGranularity ? `${store.timeGranularity} min` : "À renseigner"} /></Section>
    </div>
  </div>
}

function Summary({ title, value }: { title: string; value: string }) { return <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 text-lg font-semibold">{value}</p></CardContent></Card> }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-2">{children}</CardContent></Card> }
function Definition({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-4 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div> }
