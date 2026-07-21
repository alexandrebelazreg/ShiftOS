import { cn } from "@/lib/utils"

import type { EmployeeId } from "@/features/core/models"
import type {
  BoardEmployeeViewVM,
  BoardPanelMetricVM,
} from "@/features/planning/board/model/board-view-model"
import { LEVEL_TEXT } from "@/features/planning/board/ui/level-styles"
import { PlanningWeekTimeline } from "@/features/planning/board/ui/PlanningWeekTimeline"

interface PlanningEmployeeViewProps {
  readonly employeeView: BoardEmployeeViewVM | null
  readonly onSelectEmployee: (employeeId: EmployeeId) => void
}

/**
 * The reference view when a manager analyses one person.
 *
 * It takes over what the cramped side panel used to show, and gives the week
 * the room it needs: a full-width timeline instead of a narrow list. The panel
 * could never answer "is this week well balanced for them?" — this can.
 */
export function PlanningEmployeeView({ employeeView, onSelectEmployee }: PlanningEmployeeViewProps) {
  if (!employeeView) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        Aucun salarié dans ce secteur.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {employeeView.roster.map((person) => (
          <button
            key={person.employeeId}
            type="button"
            onClick={() => onSelectEmployee(person.employeeId)}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
              person.selected
                ? "border-primary bg-primary/10 font-medium"
                : "hover:bg-muted"
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              {person.initials}
            </span>
            {person.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Informations générales
          </h3>
          <p className="mb-3 text-lg font-semibold">{employeeView.name}</p>
          <MetricList metrics={employeeView.general} />
        </section>

        <section className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Statistiques
          </h3>
          <MetricList metrics={employeeView.stats} />
        </section>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Planning hebdomadaire
        </h3>
        <PlanningWeekTimeline hours={employeeView.hours} days={employeeView.days} />
      </section>

      {employeeView.rules.length > 0 ? (
        <details className="rounded-lg border bg-card p-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Règles applicables
          </summary>
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted-foreground">
            {employeeView.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function MetricList({ metrics }: { readonly metrics: readonly BoardPanelMetricVM[] }) {
  return (
    <dl className="space-y-2">
      {metrics.map((metric) => (
        <div key={metric.label} className="flex items-baseline justify-between gap-3 text-sm">
          <dt className="text-muted-foreground">{metric.label}</dt>
          <dd className={cn("font-semibold tabular-nums", LEVEL_TEXT[metric.level])}>
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
