"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

import type { BoardSummaryVM } from "@/features/planning/board/model/board-view-model"
import { LEVEL_DOT } from "@/features/planning/board/ui/level-styles"
import { PlanningDeficitTable } from "@/features/planning/board/ui/PlanningDeficitTable"
import { PlanningTechnicalDetails } from "@/features/planning/board/ui/PlanningTechnicalDetails"

interface PlanningSummaryProps {
  readonly summary: BoardSummaryVM
}

const STATUS_STYLE: Record<BoardSummaryVM["status"], { surface: string; icon: string }> = {
  ok: {
    surface: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
    icon: "✓",
  },
  reserves: {
    surface: "border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
    icon: "⚠",
  },
  blocked: {
    surface: "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30",
    icon: "✕",
  },
}

const ICON_TINT: Record<BoardSummaryVM["status"], string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  reserves: "text-amber-600 dark:text-amber-400",
  blocked: "text-rose-600 dark:text-rose-400",
}

/**
 * The verdict, in one line a manager can act on.
 *
 * A generation run produces dozens of technical statements; almost none change
 * what someone decides. So the headline answers the only question that matters
 * — can I publish this? — the facts sit on one line beneath it, and everything
 * else waits behind "Voir le détail" rather than filling the screen.
 */
export function PlanningSummary({ summary }: PlanningSummaryProps) {
  const [showDetail, setShowDetail] = useState(false)
  const style = STATUS_STYLE[summary.status]
  const hasDetail = summary.deficits.length > 0 || summary.technical.length > 0

  return (
    <section className={cn("rounded-lg border p-4", style.surface)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={cn("mt-0.5 text-lg leading-none", ICON_TINT[summary.status])} aria-hidden>
            {style.icon}
          </span>
          <div>
            <h2 className="text-sm font-semibold">{summary.title}</h2>
            <p className="text-sm text-muted-foreground">{summary.headline}</p>

            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5">
              {summary.facts.map((fact) => (
                <li key={fact.label} className="flex items-center gap-2 text-sm">
                  <span
                    className={cn("size-2 shrink-0 rounded-full", LEVEL_DOT[fact.level])}
                    aria-hidden
                  />
                  {fact.label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {hasDetail ? (
          <button
            type="button"
            onClick={() => setShowDetail((open) => !open)}
            aria-expanded={showDetail}
            className="rounded-md border bg-background px-3 py-1.5 text-sm transition hover:bg-muted"
          >
            {showDetail ? "Masquer le détail" : "Voir le détail"}
          </button>
        ) : null}
      </div>

      {showDetail ? (
        <div className="mt-4 space-y-3">
          <PlanningDeficitTable deficits={summary.deficits} />
          <PlanningTechnicalDetails entries={summary.technical} />
        </div>
      ) : null}
    </section>
  )
}
