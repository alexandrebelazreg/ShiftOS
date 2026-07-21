"use client"

import Link from "next/link"
import { CalendarDays, CheckCircle2, CircleAlert, Store, UsersRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useSetupReadiness } from "@/features/onboarding"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

/** Daily action centre: no empty KPI widgets, only the next useful action. */
export function ActionCenter({ store }: { store: StoreConfig | null }) {
  const setup = useSetupReadiness(store)
  const actions = setup.isLoading ? [] : setup.ready
    ? [{ title: "Planning prêt à générer", description: "Votre configuration permet de créer un nouveau planning.", href: "/planning", action: "Ouvrir le planning", icon: CalendarDays }]
    : setup.blockers.map((blocker) => ({ title: blocker, description: "Cette information est nécessaire avant de générer un planning.", href: blocker.includes("employé") ? "/configuration/employes" : "/configuration", action: blocker.includes("employé") ? "Créer un employé" : "Compléter la configuration", icon: blocker.includes("employé") ? UsersRound : Store }))

  return <div className="space-y-4">{actions.length === 0 ? <Card><CardContent className="py-6 text-sm text-muted-foreground">Vérification de la configuration…</CardContent></Card> : actions.map(({ title, description, href, action, icon: Icon }) => <Card key={title}><CardHeader><div className="flex items-start gap-3"><div className="rounded-lg bg-muted p-2"><Icon className="size-5" /></div><div><CardTitle className="text-base">{title}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{description}</p></div></div></CardHeader><CardContent><Button render={<Link href={href} />}>{action}</Button></CardContent></Card>)}{setup.ready ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="size-4 text-primary" />Configuration prête pour les opérations quotidiennes.</p> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><CircleAlert className="size-4" />Les actions proposées vous guident vers le premier planning.</p>}</div>
}
