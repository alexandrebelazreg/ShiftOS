"use client"

import { useEffect, useId, useState } from "react"

import { cn } from "@/lib/utils"

import type { BoardSummaryVM } from "@/features/planning/board/model/board-view-model"
import { LEVEL_DOT } from "@/features/planning/board/ui/level-styles"
import { PlanningDeficitTable } from "@/features/planning/board/ui/PlanningDeficitTable"

interface PlanningPublishDialogProps {
  readonly open: boolean
  readonly summary: BoardSummaryVM
  readonly busy?: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

/**
 * The publication gate for a schedule that carries reserves.
 *
 * The acceptance used to sit on the page as a permanent checkbox, which made it
 * scenery: something to tick past on the way to the button, and visible even
 * when nothing needed accepting. Asking at the moment of publishing turns it
 * back into a decision — the reserves are restated right above the box, and the
 * confirm button stays disabled until someone owns them.
 *
 * Purely presentational: it renders a ViewModel and reports two intents.
 */
export function PlanningPublishDialog({
  open,
  summary,
  busy = false,
  onCancel,
  onConfirm,
}: PlanningPublishDialogProps) {
  const [accepted, setAccepted] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const titleId = useId()
  const checkboxId = useId()

  // Every opening starts from an unchecked box: a previous acceptance must
  // never carry over to a schedule the user has not looked at yet.
  useEffect(() => {
    if (open) {
      setAccepted(false)
      setShowDetail(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-background p-5 shadow-lg"
      >
        <header className="flex items-start gap-3">
          <span className="mt-0.5 text-lg leading-none text-amber-600 dark:text-amber-400" aria-hidden>
            ⚠
          </span>
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              {summary.title}
            </h2>
            <p className="text-sm text-muted-foreground">{summary.headline}</p>
          </div>
        </header>

        <ul className="mt-4 space-y-1.5">
          {summary.facts.map((fact) => (
            <li key={fact.label} className="flex items-center gap-2 text-sm">
              <span className={cn("size-2 shrink-0 rounded-full", LEVEL_DOT[fact.level])} aria-hidden />
              {fact.label}
            </li>
          ))}
        </ul>

        {summary.deficits.length > 0 ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowDetail((value) => !value)}
              aria-expanded={showDetail}
              className="text-sm underline underline-offset-4 hover:no-underline"
            >
              {showDetail ? "Masquer le détail" : "Voir le détail"}
            </button>
            {showDetail ? (
              <div className="mt-2">
                <PlanningDeficitTable deficits={summary.deficits} />
              </div>
            ) : null}
          </div>
        ) : null}

        <label
          htmlFor={checkboxId}
          className="mt-5 flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-0.5"
          />
          <span>J’accepte explicitement les écarts de couverture avant publication.</span>
        </label>

        <footer className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm transition hover:bg-muted disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!accepted || busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Publication…" : "Publier définitivement"}
          </button>
        </footer>
      </div>
    </div>
  )
}
