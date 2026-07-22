interface PlanningEmptyWeekProps {
  /** "Semaine 31", the week the header shows. */
  readonly weekTitle: string
  readonly onGenerate: () => void
  readonly disabled?: boolean
}

/**
 * What a week with no planning shows.
 *
 * The last generated planning stays in memory, but it belongs to another week
 * and must never be rendered here under the wrong header. So this week gets an
 * honest empty state and a way out: generate it, with the active engine.
 */
export function PlanningEmptyWeek({ weekTitle, onGenerate, disabled = false }: PlanningEmptyWeekProps) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <p className="text-sm text-muted-foreground">
        Aucun planning généré pour la {weekTitle.toLowerCase()}.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={disabled}
        className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
      >
        Générer cette semaine
      </button>
    </div>
  )
}
