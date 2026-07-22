"use client"

import { useEffect, useId } from "react"

import { cn } from "@/lib/utils"

import type {
  RegenerationOptions,
  RegenerationSummary,
} from "@/features/planning/board/model/regeneration-request"

interface PlanningRegenerateDialogProps {
  readonly open: boolean
  readonly summary: RegenerationSummary
  readonly options: RegenerationOptions
  readonly onChangeOptions: (options: RegenerationOptions) => void
  readonly onCancel: () => void
  /** Regenerate now with the active engine (V2). The real, existing capability. */
  readonly onRegenerateNow: () => void
  readonly busy?: boolean
}

/**
 * The regeneration dialog, honest about two different things.
 *
 * The active engine (V2) can regenerate the week right now — that capability is
 * kept, not quietly dropped. What it cannot yet do is honour the manager's locks
 * and manual edits; that arrives with V3. So the dialog offers a working
 * "Régénérer maintenant" and, separately, previews the V3 request it is
 * preparing — never a button that leads only to a "coming with V3" message.
 *
 * Purely presentational: options are lifted to the caller, the summary is a
 * ViewModel it only displays, and regenerating is a callback it does not own.
 */
export function PlanningRegenerateDialog({
  open,
  summary,
  options,
  onChangeOptions,
  onCancel,
  onRegenerateNow,
  busy = false,
}: PlanningRegenerateDialogProps) {
  const titleId = useId()
  const lockedId = useId()
  const editsId = useId()
  const minimizeId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onCancel])

  if (!open) return null

  const set = (patch: Partial<RegenerationOptions>) => onChangeOptions({ ...options, ...patch })

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
        <h2 id={titleId} className="text-base font-semibold">
          Régénérer le planning
        </h2>

        <p className="mt-3 text-sm">
          <span className="font-medium">Régénérer avec le moteur actuel</span> recalcule le planning
          de la semaine.
        </p>
        {summary.isEmpty ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Aucun verrou ni modification locale à conserver.
          </p>
        ) : (
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Attention : {countLabel(summary)} ne seront pas conservés par le moteur actuel.
          </p>
        )}

        <div className="mt-4 rounded-md border border-dashed p-3">
          <p className="text-xs font-medium text-muted-foreground">
            À respecter à l’avenir (moteur V3)
          </p>
          <div className="mt-2 space-y-2">
            <Option
              id={lockedId}
              checked={options.preserveLockedShifts}
              onChange={(value) => set({ preserveLockedShifts: value })}
              label="Mes shifts verrouillés"
            />
            <Option
              id={editsId}
              checked={options.preserveManualEdits}
              onChange={(value) => set({ preserveManualEdits: value })}
              label="Mes modifications manuelles"
            />
            <Option
              id={minimizeId}
              checked={options.minimizeOtherChanges}
              onChange={(value) => set({ minimizeOtherChanges: value })}
              label="Limiter les changements sur le reste du planning"
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            La régénération respectant les verrous et vos modifications sera disponible avec le
            moteur V3.
          </p>
        </div>

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
            onClick={onRegenerateNow}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Régénération…" : "Régénérer maintenant"}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** "2 verrous et 1 modification", pluralised, for the not-preserved warning. */
function countLabel(summary: RegenerationSummary): string {
  const parts: string[] = []
  if (summary.lockedShiftCount > 0) {
    parts.push(`${summary.lockedShiftCount} verrou${summary.lockedShiftCount > 1 ? "s" : ""}`)
  }
  if (summary.editedShiftCount > 0) {
    parts.push(
      `${summary.editedShiftCount} modification${summary.editedShiftCount > 1 ? "s" : ""}`
    )
  }
  return parts.join(" et ")
}

interface OptionProps {
  readonly id: string
  readonly checked: boolean
  readonly onChange: (value: boolean) => void
  readonly label: string
}

function Option({ id, checked, onChange, label }: OptionProps) {
  return (
    <label htmlFor={id} className={cn("flex items-start gap-2 text-sm", "cursor-pointer")}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <span>{label}</span>
    </label>
  )
}
