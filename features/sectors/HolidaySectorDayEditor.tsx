"use client"

import type { HolidaySectorDay } from "@/features/core/models"
import { withHolidayHours } from "@/features/planning/holidays/model/holiday-sector-day"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Ce qu'un rayon fait d'un férié : ouvert ou fermé, ses horaires, et les
 * personnes voulues heure par heure.
 *
 * Le même éditeur sert au « jour férié type » des réglages du rayon et à
 * l'ajustement d'un férié précis dans l'onglet Jours fériés : deux écrans qui
 * saisiraient la même chose de deux façons finiraient par ne plus dire la même.
 */
export function HolidaySectorDayEditor({
  value,
  onChange,
  label,
}: {
  readonly value: HolidaySectorDay
  readonly onChange: (next: HolidaySectorDay) => void
  /** Pour les libellés accessibles : « Drive, 11 novembre ». */
  readonly label: string
}) {
  const valid = value.closed || value.opensAt < value.closesAt
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!value.closed}
            onChange={(event) => onChange({ ...value, closed: !event.target.checked })}
          />
          Rayon ouvert
        </label>
        {value.closed ? (
          <span className="text-sm italic text-muted-foreground">Fermé ce jour-là : personne n’y est planifié.</span>
        ) : (
          <span className="flex items-center gap-2">
            <Input
              type="time"
              step={900}
              className="w-28"
              aria-label={`Ouverture, ${label}`}
              value={value.opensAt}
              onChange={(event) => onChange(withHolidayHours(value, event.target.value, value.closesAt))}
            />
            <span className="text-sm text-muted-foreground">→</span>
            <Input
              type="time"
              step={900}
              className="w-28"
              aria-label={`Fermeture, ${label}`}
              value={value.closesAt}
              onChange={(event) => onChange(withHolidayHours(value, value.opensAt, event.target.value))}
            />
          </span>
        )}
      </div>

      {!value.closed && !valid ? (
        <p className="text-xs font-medium text-destructive">La fermeture doit suivre l’ouverture.</p>
      ) : null}

      {!value.closed && valid ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Personnes voulues par heure</p>
          <div className="flex flex-wrap gap-1.5">
            {value.slots.map((slot) => (
              <label
                key={slot.start}
                className={cn(
                  "grid w-16 gap-0.5 rounded-md border bg-muted/20 p-1 text-center text-[10px] text-muted-foreground"
                )}
              >
                {slot.start}
                <Input
                  type="number"
                  min={0}
                  step={1}
                  className="h-7 px-1 text-center text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  aria-label={`Personnes à ${slot.start}, ${label}`}
                  value={slot.employees}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      slots: value.slots.map((other) =>
                        other.start === slot.start
                          ? { ...other, employees: Math.max(0, Math.round(Number(event.target.value) || 0)) }
                          : other
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** « 06:00 → 13:00 · 2 pers. » ou « Fermé » — le résumé d'une ligne. */
export function holidaySectorDaySummary(day: HolidaySectorDay): string {
  if (day.closed) return "Fermé"
  const peak = Math.max(0, ...day.slots.map((slot) => slot.employees))
  return `${day.opensAt}–${day.closesAt} · ${peak} p.`
}
