"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CalendarClock, CalendarDays, UserRoundX } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import {
  buildDashboardAbsenceSummary,
  type DashboardAbsenceItem,
  type DashboardAbsenceSummary,
} from "@/features/absences/dashboard/absence-summary"
import { absenceService } from "@/features/absences/services/absence.service"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import type { IsoDate } from "@/features/core/models"
import { employeeService } from "@/features/employees/services/employee.service"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { validatedPaidLeaveAbsences } from "@/features/paid-leave/dashboard/validated-paid-leave"
import { paidLeaveStore } from "@/features/paid-leave/persistence/paid-leave.store"
import { cn } from "@/lib/utils"

export function TeamAbsenceSummary({ today }: { readonly today: IsoDate }) {
  const [employees, setEmployees] = useState<readonly EmployeeRecord[]>([])
  const [absences, setAbsences] = useState<readonly AbsenceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const summary = useMemo(
    () => buildDashboardAbsenceSummary(today, employees, absences),
    [absences, employees, today]
  )

  useEffect(() => {
    let active = true
    void Promise.all([employeeService.list(), absenceService.list(), paidLeaveStore.list()])
      .then(([employeeList, absenceList, campaigns]) => {
        if (!active) return
        const validatedPaidLeave = validatedPaidLeaveAbsences(campaigns)
        setEmployees(employeeList)
        setAbsences([
          ...absenceList.filter((absence) => absence.type !== "paid_leave"),
          ...validatedPaidLeave,
        ])
      })
      .catch(() => {
        if (active) setLoadError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <TeamAbsenceSummaryView
      summary={summary}
      loading={loading}
      loadError={loadError}
    />
  )
}

export function TeamAbsenceSummaryView({
  summary,
  loading = false,
  loadError = false,
}: {
  readonly summary: DashboardAbsenceSummary
  readonly loading?: boolean
  readonly loadError?: boolean
}) {
  return (
    <section aria-labelledby="team-absence-title" className="space-y-3">
      {/* Titre et explication sur UNE ligne, comme le suivi des plannings.
          Les deux blocs doivent tenir ensemble à l'écran, et une phrase sur sa
          propre ligne coûte ici autant qu'une carte d'absence. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="team-absence-title" className="font-heading text-base font-medium">
          Congés et absences
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            cette semaine et la suivante
          </span>
        </h2>
        <Link
          href="/absences"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Voir les absences
        </Link>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Impossible de charger les congés et les absences.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3" aria-busy={loading}>
          <AbsencePanel
            title="En congé aujourd’hui"
            subtitle="Absences en cours"
            items={summary.currentLeave}
            emptyLabel="Personne n’est en congé aujourd’hui."
            icon={CalendarDays}
            accent="emerald"
            loading={loading}
          />
          <AbsencePanel
            title="Départs en congé — S+1"
            subtitle={summary.nextWeekLabel}
            items={summary.nextWeekLeaveDepartures}
            emptyLabel="Aucun départ en congé la semaine prochaine."
            icon={CalendarClock}
            accent="sky"
            loading={loading}
          />
          <AbsencePanel
            title="Autres absences cette semaine"
            subtitle={summary.currentWeekLabel}
            items={summary.otherCurrentWeekAbsences}
            emptyLabel="Aucune autre absence cette semaine."
            icon={UserRoundX}
            accent="amber"
            loading={loading}
          />
        </div>
      )}
    </section>
  )
}

function AbsencePanel({
  title,
  subtitle,
  items,
  emptyLabel,
  icon: Icon,
  accent,
  loading,
}: {
  readonly title: string
  readonly subtitle: string
  readonly items: readonly DashboardAbsenceItem[]
  readonly emptyLabel: string
  readonly icon: typeof CalendarDays
  readonly accent: "amber" | "emerald" | "sky"
  readonly loading: boolean
}) {
  const accentClasses = {
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  }[accent]

  return (
    <Card className="min-h-48">
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-heading font-medium">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <span className={cn("rounded-lg p-2", accentClasses)}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3" aria-label="Chargement des absences">
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
            <div className="h-10 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.employeeName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.periodLabel}</p>
                </div>
                <Badge variant="outline">{item.typeLabel}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
