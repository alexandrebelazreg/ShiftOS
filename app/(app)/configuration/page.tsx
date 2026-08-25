import type { Metadata } from "next"
import Link from "next/link"
import { Building2, ChartNoAxesCombined, ClipboardCheck, Layers3, UsersRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"

const items = [
  { title: "Magasin", description: "Informations, horaires et paramètres du magasin.", href: "/configuration/magasin", icon: Building2 },
  { title: "Employés", description: "Profils, contrats, affectations et contraintes.", href: "/configuration/employes", icon: UsersRound },
  { title: "Secteurs", description: "Zones à couvrir et compétences requises.", href: "/configuration/secteurs", icon: Layers3 },
  { title: "Reporting", description: "Statistiques et audit de vos plannings.", href: "/configuration/reporting", icon: ChartNoAxesCombined },
  { title: "Paramètres", description: "Préférences générales de Planiteo.", href: "/configuration/parametres", icon: ClipboardCheck },
]

export const metadata: Metadata = { title: "Configuration" }

export default function ConfigurationPage() {
  return <div className="space-y-6"><PageHeader title="Configuration" description="Paramétrez votre magasin. Ces réglages sont séparés des opérations quotidiennes." /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(({ title, description, href, icon: Icon }) => <Card key={href}><CardHeader><Icon className="size-5 text-muted-foreground" /><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent><p className="mb-4 text-sm text-muted-foreground">{description}</p><Button size="sm" variant="outline" render={<Link href={href} />}>Ouvrir</Button></CardContent></Card>)}</div></div>
}
