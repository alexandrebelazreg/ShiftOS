import Link from "next/link"
import { Palmtree } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"
export default function LeavePage() { return <div className="space-y-6"><PageHeader title="Congés" description="Préparez les indisponibilités de votre équipe avant la prochaine campagne." /><Card><CardContent className="flex flex-col items-start gap-3 py-8"><Palmtree className="size-6 text-muted-foreground" /><p className="font-medium">Aucune campagne de congés en cours</p><p className="text-sm text-muted-foreground">Le module de congés sera disponible prochainement. Configurez d’abord votre équipe.</p><Button render={<Link href="/configuration/employes" />}>Voir les employés</Button></CardContent></Card></div> }
