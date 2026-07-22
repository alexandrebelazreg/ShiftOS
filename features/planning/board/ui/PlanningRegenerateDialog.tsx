"use client"

import { useEffect, useId, useState } from "react"

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
}

/**
 * The regeneration intent dialog.
 *
 * This sprint it collects an intent and nothing more: no solver is called, and
 * the primary action is honest about it — clicking "Régénérer" reveals that the
 * feature arrives with V3 rather than pretending V2 can honour locks. Cancelling
 * or closing changes nothing at all; the local edits and locks are untouched.
 *
 * Purely presentational: options are lifted to the caller, and the summary is a
 * ViewModel it only displays.
 */
export function PlanningRegenerateDialog({
  open,
  summary,
  options,
  onChangeOptions,
  onCancel,
}: PlanningRegenerateDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false)
  const titleId = useId()
  const lockedId = useId()
  const editsId = useId()
  const minimizeId = useId()

  // Every opening starts fresh: a prior acknowledgement must not carry over.
  useEffect(() => {
    if (open) setAcknowledged(false)
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

        <p className="mt-3 text-sm text-muted-foreground">Respecter lors de la régénération :</p>
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

        <div className="mt-4 rounded-md border bg-muted/30 p-3 text-sm">
          {summary.isEmpty ? (
            <p className="text-muted-foreground">Aucun verrou ni modification locale à préserver.</p>
          ) : (
            <ul className="space-y-1">
              <li>
                🔒 {summary.lockedShiftCount} shift{summary.lockedShiftCount > 1 ? "s" : ""} verrouillé
                {summary.lockedShiftCount > 1 ? "s" : ""}
              </li>
              <li>
                ✏️ {summary.editedShiftCount} shift{summary.editedShiftCount > 1 ? "s" : ""} modifié
                {summary.editedShiftCount > 1 ? "s" : ""}
              </li>
            </ul>
          )}
        </div>

        {acknowledged ? (
          <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            La régénération respectant les verrous sera disponible avec le moteur V3.
          </p>
        ) : null}

        <footer className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border px-3 py-1.5 text-sm transition hover:bg-muted"
          >
            {acknowledged ? "Fermer" : "Annuler"}
          </button>
          {acknowledged ? null : (
            <button
              type="button"
              onClick={() => setAcknowledged(true)}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition hover:brightness-110"
            >
              Régénérer
            </button>
          )}
        </footer>
      </div>
    </div>
  )
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
