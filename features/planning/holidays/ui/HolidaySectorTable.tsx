"use client"

import { useState } from "react"

import type { HolidaySectorDay, IsoDate } from "@/features/core/models"
import {
  defaultHolidaySectorDay,
  resolveHolidaySectorDay,
} from "@/features/planning/holidays/model/holiday-sector-day"
import type { HolidayOpening } from "@/features/planning/holidays/model/holiday-schedule"
import { HolidaySectorDayEditor, holidaySectorDaySummary } from "@/features/sectors/HolidaySectorDayEditor"
import type { SectorDemandConfiguration } from "@/features/sectors"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface HolidaySectorRow {
  readonly date: IsoDate
  readonly name: string
  readonly dateLabel: string
  readonly opening: HolidayOpening
  readonly opensAt: string | null
  readonly closesAt: string | null
  readonly sectorDays?: Readonly<Record<string, HolidaySectorDay>>
}

const SOURCE_LABELS = { adjusted: "ajusté", template: "modèle" } as const

/**
 * Chaque férié ouvert, rayon par rayon : ce qui s'applique, et d'où ça vient.
 *
 * Une case dit le réglage en vigueur — l'ajustement de ce férié, sinon le jour
 * férié type du rayon, sinon les horaires du magasin — parce qu'on ne corrige
 * bien que ce dont on sait la provenance. La cliquer ouvre l'ajustement.
 */
export function HolidaySectorTable({
  rows,
  sectors,
  onChange,
}: {
  readonly rows: readonly HolidaySectorRow[]
  readonly sectors: readonly SectorDemandConfiguration[]
  /** `null` retire l'ajustement : le férié revient au modèle du rayon. */
  readonly onChange: (date: IsoDate, sectorId: string, day: HolidaySectorDay | null) => void
}) {
  const [selected, setSelected] = useState<{ date: IsoDate; sectorId: string } | null>(null)
  if (rows.length === 0 || sectors.length === 0) return null

  const row = selected ? rows.find((entry) => entry.date === selected.date) : undefined
  const sector = selected ? sectors.find((entry) => entry.id === selected.sectorId) : undefined
  const adjusted = row && sector ? row.sectorDays?.[sector.id] : undefined

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-left text-xs font-medium text-muted-foreground">
              <th className="px-3 py-2">Férié</th>
              {sectors.map((entry) => (
                <th key={entry.id} className="px-3 py-2">{entry.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => (
              <tr key={entry.date} className="border-b last:border-0">
                {/* Les horaires du magasin, une fois par férié : ils sont les
                    mêmes pour tous les secteurs qui les suivent, et les répéter
                    dans chaque case cassait le tableau sur quatre lignes. */}
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="block font-medium">{entry.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {entry.dateLabel}
                    {entry.opensAt && entry.closesAt ? ` · magasin ${entry.opensAt}–${entry.closesAt}` : ""}
                  </span>
                </td>
                {sectors.map((own) => {
                  const resolved = resolveHolidaySectorDay(entry, own)
                  const active = selected?.date === entry.date && selected.sectorId === own.id
                  return (
                    <td key={own.id} className="px-3 py-1.5">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelected(active ? null : { date: entry.date, sectorId: own.id })}
                        className={cn(
                          "w-full whitespace-nowrap rounded-md border px-2 py-1 text-left text-xs transition",
                          active ? "border-primary bg-primary/10" : "hover:bg-muted"
                        )}
                      >
                        {resolved ? (
                          <>
                            <span className="block tabular-nums">{holidaySectorDaySummary(resolved)}</span>
                            <span
                              className={cn(
                                "rounded-full px-1.5 text-[10px]",
                                resolved.source === "adjusted"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {SOURCE_LABELS[resolved.source]}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Magasin</span>
                        )}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {row && sector ? (
        <div className="space-y-3 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {sector.name} · {row.name} {row.dateLabel}
            </p>
            <div className="flex gap-2">
              {adjusted ? (
                <Button size="sm" variant="outline" onClick={() => onChange(row.date, sector.id, null)}>
                  {sector.holidayDay ? "Revenir au modèle" : "Revenir aux horaires du magasin"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    onChange(
                      row.date,
                      sector.id,
                      sector.holidayDay
                        ? { ...sector.holidayDay, slots: sector.holidayDay.slots.map((slot) => ({ ...slot })) }
                        : defaultHolidaySectorDay(row.opensAt ?? "08:00", row.closesAt ?? "13:00")
                    )
                  }
                >
                  Ajuster ce férié
                </Button>
              )}
            </div>
          </div>
          {adjusted ? (
            <HolidaySectorDayEditor
              value={adjusted}
              label={`${sector.name}, ${row.name}`}
              onChange={(next) => onChange(row.date, sector.id, next)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {sector.holidayDay
                ? "Ce férié suit le jour férié type du secteur. Ajustez-le pour lui donner d’autres horaires ou un autre besoin."
                : "Ce secteur n’a pas de jour férié type : il suit les horaires du magasin. Ajustez ce férié, ou réglez un modèle dans les réglages du secteur."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
