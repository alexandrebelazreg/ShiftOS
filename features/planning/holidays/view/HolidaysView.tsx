"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { PageHeader } from "@/components/layout/page-header"
import { cn } from "@/lib/utils"

import type { IsoDate, WeekDay } from "@/features/core/models"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { type StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { holidayStore } from "@/features/planning/holidays/holiday.store"
import { SaveFailureBanner } from "@/components/feedback/save-failure-banner"
import { useSaveFailure } from "@/components/feedback/use-save-failure"
import { buildHolidayVolunteerMatrix } from "@/features/planning/holidays/model/holiday-volunteer-matrix"
import { buildHolidayYear } from "@/features/planning/holidays/model/holiday-year-view-model"
import { HolidayVolunteerMatrix } from "@/features/planning/holidays/ui/HolidayVolunteerMatrix"
import { HolidayYearTable } from "@/features/planning/holidays/ui/HolidayYearTable"
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
  const { failure, guard } = useSaveFailure()
  const [year, setYear] = useState(() => new Date().getFullYear())

  useEffect(() => {
    if (typeof window === "undefined") return
    let active = true
    void holidayStore.read().then((stored) => {
      if (active) setStored(stored)
    })
    return () => {
      active = false
    }
  }, [])

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

  const volunteerMatrix = useMemo(
    () => buildHolidayVolunteerMatrix(holidayYear),
    [holidayYear]
  )

  /** Écrire une journée, et n'écrire que ce que le gérant a changé. */
  const patchDay = (date: IsoDate, patch: Partial<StoredHolidays[IsoDate]>) => {
    setStored((current) => {
      const next: StoredHolidays = {
        ...(current ?? {}),
        [date]: { ...(current?.[date] ?? {}), ...patch },
      }
      void guard(() => holidayStore.save(next))
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
      <SaveFailureBanner failure={failure} what="Ce réglage de jour férié" />
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

      <HolidayYearTable
        year={holidayYear}
        onChangeOpening={(date, opening) => patchDay(date, { opening })}
        onChangeHours={(date, opensAt, closesAt) => patchDay(date, { opensAt, closesAt })}
      />

      {/* LES VOLONTAIRES SE COCHENT ICI, ET NULLE PART AILLEURS.
          Ils vivaient dans onze listes dépliables, une par férié : on pouvait
          régler l'année sans jamais voir que la même personne avait dit oui à
          tout et une autre à rien. La matrice répond à cette question en la
          montrant, et c'est son déménagement qui a permis de réduire chaque
          férié à une ligne. */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-medium">
            Volontaires
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              sur les fériés ouverts
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Un volontaire est <strong className="font-medium text-foreground">éligible</strong>,
            pas affecté : le cocher autorise le générateur à le retenir, sans lui imposer d’y venir.
          </p>
        </div>
        <HolidayVolunteerMatrix
          matrix={volunteerMatrix}
          onToggle={(date, employeeId) => {
            const current = stored[date]?.volunteerIds ?? []
            patchDay(date, {
              volunteerIds: current.includes(employeeId)
                ? current.filter((id) => id !== employeeId)
                : [...current, employeeId],
            })
          }}
        />
      </section>

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
