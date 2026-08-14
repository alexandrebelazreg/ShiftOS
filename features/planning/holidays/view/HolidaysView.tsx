"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { PageHeader } from "@/components/layout/page-header"
import { cn } from "@/lib/utils"

import type { IsoDate, WeekDay } from "@/features/core/models"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { createHolidayRepository, type StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { buildHolidayYear } from "@/features/planning/holidays/model/holiday-year-view-model"
import type { HolidayOpening } from "@/features/planning/holidays/model/holiday-schedule"
import { HolidayDayCard } from "@/features/planning/holidays/ui/HolidayDayCard"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

/**
 * L'écran des jours fériés : ce que le magasin en fait, et qui accepte d'y venir.
 *
 * Un seul écran pour les deux, parce qu'ils ne se lisent pas séparément. Régler
 * une journée en « chômé » retire la question des volontaires ; la poser
 * ailleurs aurait laissé recruter pour un jour où le rideau reste baissé.
 *
 * Les volontaires sont des ÉLIGIBLES, pas des affectations : cocher quelqu'un
 * ne le place pas ce jour-là, cela autorise le générateur à le retenir. C'est
 * l'arbitrage de départ, et il est écrit à l'écran pour qu'aucune case ne soit
 * cochée en croyant faire un planning.
 */
export function HolidaysView({ initialStore }: { readonly initialStore: StoreConfig | null }) {
  const { employees, isLoading } = useEmployees()
  const [stored, setStored] = useState<StoredHolidays | null>(null)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [expanded, setExpanded] = useState<IsoDate | null>(null)

  const repository = useMemo(
    () => (typeof window === "undefined" ? null : createHolidayRepository(window.localStorage)),
    []
  )

  useEffect(() => {
    if (!repository) return
    queueMicrotask(() => setStored(repository.read()))
  }, [repository])

  /**
   * Les horaires habituels du magasin pour cette date : le point de départ
   * proposé pour un férié ouvert. Le gérant les remplace presque toujours —
   * c'est bien pour cela qu'on les lui montre plutôt que de les deviner.
   */
  const usualHours = useCallback(
    (date: IsoDate) => {
      const weekDay = weekDayOf(date)
      const entry = initialStore?.openingHours.find((hours) => hours.day === weekDay)
      if (!entry || entry.closed || !entry.opensAt || !entry.closesAt) return null
      return { opensAt: entry.opensAt, closesAt: entry.closesAt }
    },
    [initialStore]
  )

  const holidayYear = useMemo(
    () =>
      buildHolidayYear({
        year,
        stored: stored ?? {},
        employees: employees.map((employee) => ({
          id: employee.id,
          name: `${employee.firstName} ${employee.lastName}`.trim(),
          scheduleType: employee.scheduleType,
          student: employee.student,
          forfaitJour: employee.forfaitJour,
          active: employee.status === "active",
        })),
        usualHours,
      }),
    [year, stored, employees, usualHours]
  )

  /** Écrire une journée, et n'écrire que ce que le gérant a changé. */
  const patchDay = (date: IsoDate, patch: Partial<StoredHolidays[IsoDate]>) => {
    setStored((current) => {
      const next: StoredHolidays = {
        ...(current ?? {}),
        [date]: { ...(current?.[date] ?? {}), ...patch },
      }
      repository?.save(next)
      return next
    })
  }

  if (stored === null || isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Jours fériés" description="Chargement…" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jours fériés"
        description="Réglez ce que le magasin fait de chaque férié, puis recueillez les volontaires."
      />

      <div className="flex flex-wrap items-center gap-2">
        {holidayYear.years.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setYear(option)}
            aria-pressed={option === holidayYear.year}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm tabular-nums transition",
              option === holidayYear.year
                ? "border-primary bg-primary/10 font-medium"
                : "hover:bg-muted"
            )}
          >
            {option}
          </button>
        ))}
        <p className="ml-auto text-sm text-muted-foreground">
          {holidayYear.openCount} férié{holidayYear.openCount > 1 ? "s" : ""} ouvert
          {holidayYear.openCount > 1 ? "s" : ""} sur {holidayYear.days.length}
        </p>
      </div>

      {/* Des avertissements, jamais des refus : un magasin peut avoir une raison
          de fermer tôt un dimanche férié, et un blocage se ferait contourner. */}
      {holidayYear.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {holidayYear.warnings.map((warning) => (
            <li key={`${warning.date}_${warning.message}`}>{warning.message}</li>
          ))}
        </ul>
      ) : null}

      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Un volontaire est <strong>éligible</strong>, pas affecté : cocher quelqu’un autorise le
        générateur à le retenir ce jour-là, sans lui imposer d’y venir.
      </p>

      <div className="space-y-3">
        {holidayYear.days.map((day) => (
          <HolidayDayCard
            key={day.date}
            day={day}
            expanded={expanded === day.date}
            onToggleExpanded={() => setExpanded((current) => (current === day.date ? null : day.date))}
            onChangeOpening={(opening: HolidayOpening) => patchDay(day.date, { opening })}
            onChangeHours={(opensAt, closesAt) => patchDay(day.date, { opensAt, closesAt })}
            onToggleVolunteer={(employeeId) => {
              const current = stored[day.date]?.volunteerIds ?? []
              patchDay(day.date, {
                volunteerIds: current.includes(employeeId)
                  ? current.filter((id) => id !== employeeId)
                  : [...current, employeeId],
              })
            }}
          />
        ))}
      </div>
    </div>
  )
}

const WEEK_DAYS_BY_INDEX: readonly WeekDay[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]

function weekDayOf(date: IsoDate): WeekDay {
  const [year, month, day] = date.split("-").map(Number)
  return WEEK_DAYS_BY_INDEX[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
}
