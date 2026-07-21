import Link from "next/link"
import { UserRoundX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"
export default function AbsencePage() { return <div className="space-y-6"><PageHeader title="Absences" description="Consultez et préparez les absences de l’équipe." /><Card><CardContent className="flex flex-col items-start gap-3 py-8"><UserRoundX className="size-6 text-muted-foreground" /><p className="font-medium">Aucune absence à traiter</p><p className="text-sm text-muted-foreground">Le suivi des absences sera disponible prochainement. Les contraintes individuelles restent configurables.</p><Button render={<Link href="/configuration/employes" />}>Configurer les contraintes</Button></CardContent></Card></div> }
