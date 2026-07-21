/**
 * Reusable wizard progress indicator ("Step X / Y" + a progress bar).
 * Presentational — the current/total steps are provided by the caller.
 */
export function StepProgress({
  current,
  total,
  labels,
}: {
  current: number
  total: number
  labels?: readonly string[]
}) {
  const percent = Math.round((current / total) * 100)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Étape {current} / {total}{labels?.[current - 1] ? ` — ${labels[current - 1]}` : ""}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
