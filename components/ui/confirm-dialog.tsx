"use client"

import * as React from "react"
import { AlertDialog } from "@base-ui/react/alert-dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * La confirmation d'un geste qu'on ne peut pas défaire.
 *
 * Bâti sur `AlertDialog` et non sur `Dialog` : un dialogue ordinaire se ferme
 * sur un clic à côté ou sur Échap, ce qui convient à un panneau de saisie et
 * pas du tout à une destruction. Celui-ci exige un choix.
 *
 * Il montre aussi ce qui EMPÊCHE, pas seulement ce qui va se produire : quand
 * une fiche est citée ailleurs, la liste des citations remplace le bouton de
 * confirmation. Un refus muet enverrait chercher la cause au hasard.
 */

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly title: string
  readonly description: React.ReactNode
  /** Ce qui interdit le geste. Non vide, le dialogue devient un refus motivé. */
  readonly blockedBy?: readonly string[]
  readonly blockedTitle?: string
  readonly confirmLabel?: string
  readonly cancelLabel?: string
  readonly onConfirm: () => void
  readonly isPending?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  blockedBy,
  blockedTitle = "Ce n’est pas possible pour l’instant :",
  confirmLabel = "Supprimer définitivement",
  cancelLabel = "Annuler",
  onConfirm,
  isPending = false,
}: ConfirmDialogProps) {
  const blocked = (blockedBy?.length ?? 0) > 0

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop
          className={cn(
            "fixed inset-0 z-50 bg-black/20 transition-opacity duration-150",
            "data-ending-style:opacity-0 data-starting-style:opacity-0",
            "supports-backdrop-filter:backdrop-blur-xs"
          )}
        />
        <AlertDialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
            "flex flex-col gap-4 rounded-xl border bg-popover p-5 text-sm text-popover-foreground shadow-lg",
            "transition duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
            "data-ending-style:scale-95 data-starting-style:scale-95"
          )}
        >
          <div className="space-y-1.5">
            <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">
              {description}
            </AlertDialog.Description>
          </div>

          {blocked ? (
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium">{blockedTitle}</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {blockedBy!.slice(0, 6).map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              {blockedBy!.length > 6 ? (
                <p className="text-xs text-muted-foreground">
                  … et {blockedBy!.length - 6} autre{blockedBy!.length - 6 > 1 ? "s" : ""}.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialog.Close render={<Button variant="outline" />}>
              {blocked ? "Fermer" : cancelLabel}
            </AlertDialog.Close>
            {blocked ? null : (
              <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
                {isPending ? "Suppression…" : confirmLabel}
              </Button>
            )}
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
