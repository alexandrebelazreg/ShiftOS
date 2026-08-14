"use client"

import { cn } from "@/lib/utils"

import type { HolidayDayVM } from "@/features/planning/holidays/model/holiday-year-view-model"
import {
  HOLIDAY_OPENING_LABELS,
  type HolidayOpening,
} from "@/features/planning/holidays/model/holiday-schedule"

interface HolidayDayCardProps {
  readonly day: HolidayDayVM
  readonly expanded: boolean
  readonly onToggleExpanded: () => void
  readonly onChangeOpening: (opening: HolidayOpening) => void
  readonly onChangeHours: (opensAt: string, closesAt: string) => void
  readonly onToggleVolunteer: (employeeId: string) => void
}

const OPENINGS: readonly HolidayOpening[] = ["chome", "demi-chome", "travaille"]

/**
 * Un jour férié : ce que le magasin en fait, puis qui accepte d'y venir.
 *
 * Les deux dans cet ordre et sur la même carte, parce que le second n'a de sens
 * qu'une fois le premier réglé — on ne recrute pas de volontaires pour une
 * journée chômée, et la liste ne s'ouvre donc pas.
 */
export function HolidayDayCard({
  day,
  expanded,
  onToggleExpanded,
  onChangeOpening,
  onChangeHours,
  onToggleVolunteer,
}: HolidayDayCardProps) {
  return (
    <section className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {day.name}
            {/* Un dimanche férié suit le second tableau de la documentation :
                le signaler évite de le régler comme un férié ordinaire. */}
            {day.sunday ? (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                Dimanche
              </span>
            ) : null}
          </h3>
          <p className="text-xs text-muted-foreground">
            {day.dateLabel} · {day.openingLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {OPENINGS.map((opening) => (
            <label
              key={opening}
              className={cn(
                "cursor-pointer rounded-md border px-2.5 py-1 text-xs transition",
                day.opening === opening ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={`opening_${day.date}`}
                checked={day.opening === opening}
                onChange={() => onChangeOpening(opening)}
              />
              {HOLIDAY_OPENING_LABELS[opening]}
            </label>
          ))}
        </div>
      </div>

      {day.acceptsVolunteers ? (
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Ouverture</span>
              <input
                type="time"
                value={day.opensAt ?? ""}
                onChange={(event) => onChangeHours(event.target.value, day.closesAt ?? "")}
                className="rounded-md border bg-background px-2 py-1 text-sm tabular-nums"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Fermeture</span>
              <input
                type="time"
                value={day.closesAt ?? ""}
                onChange={(event) => onChangeHours(day.opensAt ?? "", event.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-sm tabular-nums"
              />
            </label>

            <button
              type="button"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
              className="ml-auto rounded-md border px-3 py-1.5 text-sm transition hover:bg-muted"
            >
              {day.volunteerCountLabel}
              <span aria-hidden className="ml-2 text-muted-foreground">
                {expanded ? "▾" : "▸"}
              </span>
            </button>
          </div>

          {expanded ? (
            <ul className="grid gap-1 border-t pt-3 sm:grid-cols-2">
              {day.volunteers.map((volunteer) => (
                <li key={volunteer.employeeId}>
                  <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={volunteer.volunteer}
                      onChange={() => onToggleVolunteer(volunteer.employeeId)}
                    />
                    <span className="min-w-0 flex-1 truncate">{volunteer.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {volunteer.scheduleLabel}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Magasin fermé : personne n’est planifié, il n’y a pas de volontaire à recueillir.
        </p>
      )}
    </section>
  )
}
