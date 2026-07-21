interface PlanningTechnicalDetailsProps {
  readonly entries: readonly { readonly label: string; readonly value: string }[]
}

/**
 * Everything a manager never needs to read, kept one click away.
 *
 * Structural surplus, avoidable surplus, phase traces, repair statistics: all
 * of it is useful to whoever supports the product and to nobody deciding
 * whether to publish a week. Collapsed by default, never removed — a support
 * question should still be answerable without a rebuild.
 */
export function PlanningTechnicalDetails({ entries }: PlanningTechnicalDetailsProps) {
  if (entries.length === 0) return null

  return (
    <details className="rounded-md border bg-background">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-muted-foreground">
        Afficher les détails techniques
      </summary>
      <dl className="space-y-1.5 border-t px-3 py-3 text-sm">
        {entries.map((entry) => (
          <div key={entry.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{entry.label}</dt>
            <dd className="text-right tabular-nums">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
