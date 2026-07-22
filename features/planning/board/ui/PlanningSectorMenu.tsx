"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

import { summarizeSectorSelection, type SectorChoice } from "@/features/planning/board/model/header-controls"

interface PlanningSectorMenuProps {
  readonly sectors: readonly SectorChoice[]
  readonly onToggleSector: (sectorId: string) => void
  readonly onToggleAll: (selectAll: boolean) => void
}

/**
 * The sector picker: a checkbox menu that allows any combination.
 *
 * The closed button only summarises — the label comes from a pure function, so
 * the wording ("Drive + Zone Marché", "3 secteurs", "Tous les secteurs") is
 * decided once and tested outside React. Opening reveals a "Tous les secteurs"
 * master toggle plus one checkbox per sector; nothing is hard-coded to a known
 * set, so a new sector needs no change here.
 */
export function PlanningSectorMenu({ sectors, onToggleSector, onToggleAll }: PlanningSectorMenuProps) {
  const [open, setOpen] = useState(false)
  const allSelected = sectors.length > 0 && sectors.every((sector) => sector.selected)
  const label = summarizeSectorSelection(sectors)

  return (
    <div className="relative">
      <span className="sr-only" id="sector-menu-label">
        Secteurs
      </span>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-labelledby="sector-menu-label"
        className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-sm transition hover:bg-muted"
      >
        <span className="text-muted-foreground">Secteur :</span>
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground" aria-hidden>
          ▼
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute left-0 z-40 mt-1 min-w-52 rounded-md border bg-background p-1 shadow-lg">
            <MenuOption
              label="Tous les secteurs"
              checked={allSelected}
              onChange={() => onToggleAll(!allSelected)}
              strong
            />
            <div className="my-1 border-t" />
            {sectors.map((sector) => (
              <MenuOption
                key={sector.id}
                label={sector.name}
                checked={sector.selected}
                onChange={() => onToggleSector(sector.id)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

interface MenuOptionProps {
  readonly label: string
  readonly checked: boolean
  readonly onChange: () => void
  readonly strong?: boolean
}

function MenuOption({ label, checked, onChange, strong }: MenuOptionProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition hover:bg-muted",
        strong && "font-medium"
      )}
    >
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}
