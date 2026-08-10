"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CircleDashed, Send, Save } from "lucide-react"

import { cn } from "@/lib/utils"
import type { IsoDate } from "@/features/core/models"
import {
  buildPlanningWeekStatuses,
  type PlanningWeekState,
} from "@/features/planning/dashboard/planning-week-status"
import {
  planningStore,
  type PlanningSummary,
} from "@/features/planning/persistence"

const STATE_UI = {
  untreated: {
    label: "Non traité",
    icon: CircleDashed,
    className: "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70",
    dotClassName: "bg-muted-foreground/60",
  },
  saved: {
    label: "Enregistré",
    icon: Save,
    className: "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60",
    dotClassName: "bg-amber-500",
  },
  published: {
    label: "Publié",
    icon: Send,
    className: "border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60",
    dotClassName: "bg-emerald-500",
  },
} satisfies Record<PlanningWeekState, {
  readonly label: string
  readonly icon: typeof CircleDashed
  readonly className: string
  readonly dotClassName: string
}>

export function PlanningWeekStatusStrip({ today }: { readonly today: IsoDate }) {
  const [plannings, setPlannings] = useState<readonly PlanningSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const weeks = useMemo(
    () => buildPlanningWeekStatuses(today, plannings),
    [plannings, today]
  )

  useEffect(() => {
    let active = true
    void planningStore.list()
      .then((items) => {
        if (active) setPlannings(items)
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <section aria-labelledby="planning-horizon-title" className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="planning-horizon-title" className="font-heading text-base font-medium">
            Suivi des plannings
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            De la semaine en cours jusqu’à S+6. Cliquez sur une semaine pour l’ouvrir.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Légende">
          {(Object.keys(STATE_UI) as PlanningWeekState[]).map((state) => (
            <span key={state} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", STATE_UI[state].dotClassName)} aria-hidden="true" />
              {STATE_UI[state].label}
            </span>
          ))}
        </div>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Impossible de charger le suivi des plannings.
        </p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-[52rem] grid-cols-7 gap-2" aria-busy={loading}>
            {weeks.map((week) => {
              const ui = STATE_UI[week.state]
              const Icon = ui.icon
              const params = new URLSearchParams({ week: week.weekStart })
              if (week.planningId) params.set("planningId", week.planningId)

              return (
                <Link
                  key={week.weekStart}
                  href={`/planning?${params.toString()}`}
                  className={cn(
                    "group rounded-lg border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    ui.className,
                    loading && "animate-pulse pointer-events-none"
                  )}
                  aria-label={`Semaine ${week.weekNumber}, ${ui.label}`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block text-xs font-medium opacity-75">{week.offsetLabel}</span>
                      <span className="mt-0.5 block text-lg font-semibold">S{week.weekNumber}</span>
                    </span>
                    <Icon className="size-4 opacity-75" aria-hidden="true" />
                  </span>
                  <span className="mt-3 block text-xs tabular-nums opacity-75">{week.rangeLabel}</span>
                  <span className="mt-1.5 block text-xs font-medium">{ui.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
