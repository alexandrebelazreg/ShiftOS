"use client"

import { useEffect, useId } from "react"

interface PlanningWeekChangeDialogProps {
  readonly open: boolean
  readonly busy?: boolean
  readonly onCancel: () => void
  readonly onDiscardAndChange: () => void
  readonly onSaveAndChange: () => void
}

/**
 * The guard that stands between unsaved work and a week change.
 *
 * It offers the three honest outcomes and nothing else: stay, leave and lose the
 * local work, or save first and leave only if that succeeds. Purely
 * presentational — every outcome is a callback the owner decides how to honour.
 */
export function PlanningWeekChangeDialog({
  open,
  busy = false,
  onCancel,
  onDiscardAndChange,
  onSaveAndChange,
}: PlanningWeekChangeDialogProps) {
  const titleId = useId()

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
        className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold">
          Des modifications ne sont pas enregistrées.
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Que souhaitez-vous faire ?</p>

        <footer className="mt-5 flex flex-wrap justify-end gap-2">
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
            onClick={onDiscardAndChange}
            disabled={busy}
            className="rounded-md border px-3 py-1.5 text-sm transition hover:bg-muted disabled:opacity-50"
          >
            Changer sans enregistrer
          </button>
          <button
            type="button"
            onClick={onSaveAndChange}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Enregistrement…" : "Enregistrer puis changer"}
          </button>
        </footer>
      </div>
    </div>
  )
}
