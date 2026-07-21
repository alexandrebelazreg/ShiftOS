import { Clock } from "lucide-react"

/** Placeholder tab — history is not implemented yet. */
export function HistoriqueTab() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
      <Clock className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium text-muted-foreground">
        Bientôt disponible.
      </p>
    </div>
  )
}
