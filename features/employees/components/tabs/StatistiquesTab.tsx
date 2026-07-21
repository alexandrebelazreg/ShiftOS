import { BarChart3 } from "lucide-react"

export function StatistiquesTab() {
  return <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center"><BarChart3 className="size-5 text-muted-foreground" /><p className="text-sm font-medium">Les statistiques apparaîtront après le premier planning.</p></div>
}
