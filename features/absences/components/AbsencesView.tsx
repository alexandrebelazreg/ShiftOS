"use client"

import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { IsoDate } from "@/features/core/models"
import { weekDayOf } from "@/features/core/shared"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { getFullName } from "@/features/employees/utils/employee.format"
import { validatedPaidLeaveAbsences } from "@/features/paid-leave/dashboard/validated-paid-leave"
import { createPaidLeaveRepository } from "@/features/paid-leave/persistence/paid-leave-repository"
import {
  createHolidayRepository,
  type StoredHolidays,
} from "@/features/planning/holidays/holiday.repository"
import {
  closedHolidayDates,
  holidayAbsences,
} from "@/features/planning/holidays/model/holiday-absences"
import { defaultHolidaySchedules } from "@/features/planning/holidays/model/holiday-schedule"
import { planningStore } from "@/features/planning/persistence/planning-store"
import type { PlanningSummary } from "@/features/planning/persistence/planning-record"
import { storeOpensOn } from "@/features/store/lib/opening-days"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import {
  buildAbsenceAlerts,
  hasAlerts,
} from "@/features/absences/alerts/absence-alerts"
import {
  buildAbsenceMonth,
  buildYearCounters,
  MONTH_LABELS,
} from "@/features/absences/calendar/absence-month"
import { AbsenceForm } from "@/features/absences/components/AbsenceForm"
import {
  AbsenceLegend,
  AbsenceMonthGrid,
} from "@/features/absences/components/AbsenceMonthGrid"
import { absencePeriodLabel } from "@/features/absences/models/absence-period"
import { absenceMotiveLabel } from "@/features/absences/models/absence-motive"
import {
  DEFAULT_ABSENCE_RULES,
  type AbsenceRules,
} from "@/features/absences/models/absence-rules"
import { createAbsenceRulesRepository } from "@/features/absences/persistence/absence-rules.repository"
import { absenceService, type AbsenceDraft } from "@/features/absences/services/absence.service"
import {
  ABSENCE_SOURCE_NOTICES,
  type AbsenceRecord,
} from "@/features/absences/types/absence-record"

/**
 * L'écran des absences : le mois de l'équipe, et ce qui réclame une action.
 *
 * Le bandeau n'est pas un en-tête permanent — il n'existe que s'il a quelque
 * chose à dire. Deux choses seulement peuvent l'y faire apparaître : un
 * justificatif qui devait être arrivé, et une absence qui tombe sur un planning
 * déjà fait. Cette seconde ligne est indispensable ici PARCE QUE l'application
 * ne touche jamais aux plannings : sans elle, le trou n'existerait nulle part
 * avant le matin où il se voit dans le magasin.
 *
 * Les congés de campagne sont affichés et non modifiables. Sans eux, le
 * calendrier annoncerait une équipe au complet la semaine du 15 juillet.
 */
export function AbsencesView({ initialStore }: { readonly initialStore: StoreConfig | null }) {
  const { employees, isLoading } = useEmployees()
  const today = useMemo(() => new Date().toISOString().slice(0, 10) as IsoDate, [])
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)))
  const [saved, setSaved] = useState<readonly AbsenceRecord[]>([])
  const [campaignLeave, setCampaignLeave] = useState<readonly AbsenceRecord[]>([])
  const [holidays, setHolidays] = useState<StoredHolidays>({})
  const [plannings, setPlannings] = useState<readonly PlanningSummary[]>([])
  const [rules, setRules] = useState<AbsenceRules>(DEFAULT_ABSENCE_RULES)
  const [formOpen, setFormOpen] = useState(false)
  const [selected, setSelected] = useState<AbsenceRecord | null>(null)

  // `.then` plutôt qu'`await` : poser l'état DANS l'effet, sans frontière
  // asynchrone, déclenche une seconde passe de rendu à chaque montage — c'est la
  // même précaution que dans l'écran des permanences.
  const reload = useCallback(() => absenceService.list().then(setSaved), [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (typeof window === "undefined") return
    queueMicrotask(() => {
      // Les règles réglées dans les paramètres : sans elles, cet écran
      // annoncerait un justificatif que personne ne réclamera, et en réclamerait
      // un que le gérant a retiré.
      setRules(createAbsenceRulesRepository(window.localStorage).read())
      // Les congés validés viennent de leur propre écran : cet écran les LIT,
      // pour ne pas annoncer une équipe au complet la semaine du 15 juillet.
      setCampaignLeave(validatedPaidLeaveAbsences(createPaidLeaveRepository(window.localStorage).list()))
      // Les fériés viennent aussi de leur propre écran : sur un férié
      // travaillé, ceux qui ne se sont pas portés volontaires ne viennent pas.
      setHolidays(createHolidayRepository(window.localStorage).read())
    })
    void planningStore.list().then(setPlannings)
  }, [])

  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.status === "active"),
    [employees]
  )

  /**
   * Les fériés de l'année affichée, réglés.
   *
   * Les horaires habituels servent de proposition, exactement comme dans
   * l'écran des jours fériés : c'est le même calcul, et deux lectures
   * différentes du même férié finiraient par ne pas dire la même chose.
   */
  const holidaySchedules = useMemo(
    () =>
      defaultHolidaySchedules(year, (date) => {
        const entry = initialStore?.openingHours.find((hours) => hours.day === weekDayOf(date))
        if (!entry || entry.closed) return null
        return { opensAt: entry.opensAt, closesAt: entry.closesAt }
      }),
    [year, initialStore]
  )

  const holidayLeave = useMemo(
    () =>
      holidayAbsences({
        schedules: holidaySchedules,
        stored: holidays,
        employeeIds: activeEmployees.map((employee) => employee.id),
      }),
    [holidaySchedules, holidays, activeEmployees]
  )

  const closedHolidays = useMemo(
    () => closedHolidayDates({ schedules: holidaySchedules, stored: holidays }),
    [holidaySchedules, holidays]
  )

  // Les trois sources se lisent ensemble : le calendrier doit dire qui est là,
  // pas qui a été saisi ici.
  const absences = useMemo(
    () => [...saved, ...campaignLeave, ...holidayLeave],
    [saved, campaignLeave, holidayLeave]
  )

  const employeeNames = useMemo(
    () => new Map(activeEmployees.map((employee) => [employee.id, getFullName(employee)])),
    [activeEmployees]
  )

  const monthModel = useMemo(
    () =>
      buildAbsenceMonth({
        year,
        month,
        employees: activeEmployees,
        absences,
        opensOn: (day) => storeOpensOn(initialStore, day),
        closedDates: closedHolidays,
      }),
    [year, month, activeEmployees, absences, initialStore, closedHolidays]
  )

  const alerts = useMemo(
    () => buildAbsenceAlerts({ today, absences: saved, plannings, employeeNames, rules }),
    [today, saved, plannings, employeeNames, rules]
  )

  const counters = useMemo(() => buildYearCounters(year, absences), [year, absences])

  async function create(draft: AbsenceDraft) {
    await absenceService.create(draft, today, rules)
    setFormOpen(false)
    await reload()
  }

  async function cancel(id: string) {
    await absenceService.cancel(id, today)
    setSelected(null)
    await reload()
  }

  async function extend(id: string, newEnd: string) {
    await absenceService.extend(id, newEnd, today)
    const updated = await absenceService.list()
    setSaved(updated)
    setSelected(updated.find((absence) => absence.id === id) ?? null)
  }

  async function receiveProof(id: string) {
    await absenceService.markProofReceived(id, today)
    setSelected(null)
    await reload()
  }

  function step(delta: number) {
    const next = month + delta
    if (next < 1) {
      setMonth(12)
      setYear(year - 1)
    } else if (next > 12) {
      setMonth(1)
      setYear(year + 1)
    } else {
      setMonth(next)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Absences"
        description="Qui n’est pas là, pourquoi, et ce qu’il reste à réclamer."
      />

      {hasAlerts(alerts) ? (
        <Card className="border-amber-500/50">
          <CardContent className="space-y-2 py-4 text-sm">
            {alerts.onPlannedWeeks.length > 0 ? (
              <div>
                <p className="font-medium">
                  {alerts.onPlannedWeeks.length} absence
                  {alerts.onPlannedWeeks.length > 1 ? "s tombent" : " tombe"} sur un planning déjà
                  fait.
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {alerts.onPlannedWeeks.map((collision) => (
                    <li key={collision.absence.id}>
                      {collision.employeeName}, {absencePeriodLabel(collision.absence)} —{" "}
                      {collision.plannings
                        .map((planning) => `${planning.label}${planning.published ? " (affiché)" : ""}`)
                        .join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {alerts.lateProofs.length > 0 ? (
              <div>
                <p className="font-medium">Justificatifs en retard</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {alerts.lateProofs.map((late) => (
                    <li key={late.absence.id}>
                      {late.employeeName} — {late.proofLabel} attendu depuis {late.lateDays} jour
                      {late.lateDays > 1 ? "s" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label="Mois précédent">
            <ChevronLeft />
          </Button>
          <span className="min-w-40 text-center text-sm font-medium">
            {MONTH_LABELS[month - 1]} {year}
          </span>
          <Button variant="outline" size="sm" onClick={() => step(1)} aria-label="Mois suivant">
            <ChevronRight />
          </Button>
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus />
          Enregistrer une absence
        </Button>
      </div>

      {formOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Nouvelle absence</CardTitle>
          </CardHeader>
          <CardContent>
            <AbsenceForm
              employees={activeEmployees}
              today={today}
              rules={rules}
              onSubmit={create}
              onCancel={() => setFormOpen(false)}
            />
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement de l’équipe…</p>
      ) : (
        <div className="space-y-3">
          <AbsenceMonthGrid month={monthModel} onPick={(cell) => setSelected(cell.absence)} />
          <AbsenceLegend month={monthModel} />
        </div>
      )}

      {selected ? (
        <AbsenceDetail
          absence={selected}
          name={employeeNames.get(selected.employeeId) ?? "Employé"}
          onClose={() => setSelected(null)}
          onCancelAbsence={cancel}
          onProofReceived={receiveProof}
          onExtend={extend}
        />
      ) : null}

      {counters.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Compteurs {year}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {counters.map((line) => (
                <li key={line.type} className="flex justify-between gap-4 border-b border-border/50 py-1">
                  <span>{line.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {line.hours > 0 ? `${line.hours} h` : `${line.days} j`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

/**
 * Le détail d'une absence, ouvert depuis une case.
 *
 * Une absence de campagne n'y offre aucun bouton : elle se lit, elle se corrige
 * dans l'écran Congés. Une absence annulée reste lisible, barrée — c'est
 * précisément l'enregistrement qu'on cherchera six mois plus tard.
 */
function AbsenceDetail({
  absence,
  name,
  onClose,
  onCancelAbsence,
  onProofReceived,
  onExtend,
}: {
  readonly absence: AbsenceRecord
  readonly name: string
  readonly onClose: () => void
  readonly onCancelAbsence: (id: string) => void | Promise<void>
  readonly onProofReceived: (id: string) => void | Promise<void>
  readonly onExtend: (id: string, newEnd: string) => void | Promise<void>
}) {
  const [extending, setExtending] = useState(false)
  const [newEnd, setNewEnd] = useState(absence.end)
  const notice = absence.source ? ABSENCE_SOURCE_NOTICES[absence.source] : null
  const cancelled = absence.status === "cancelled"

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <CardTitle className={cancelled ? "line-through" : undefined}>
          {name} — {absenceMotiveLabel(absence.type)}
        </CardTitle>
        <Button variant="outline" size="sm" onClick={onClose} aria-label="Fermer le détail">
          <X />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {absencePeriodLabel(absence)}
          {absence.hours !== undefined ? ` — ${absence.hours} h` : ""}
          {absence.note ? ` — ${absence.note}` : ""}
        </p>

        {/* L'historique, et pas seulement la date d'aujourd'hui : un arrêt de
            quinze jours et trois arrêts de cinq jours bout à bout ne se valent
            ni pour la paie ni pour la prévoyance. */}
        {absence.extensions && absence.extensions.length > 0 ? (
          <div>
            <p className="font-medium">
              Prolongée {absence.extensions.length} fois
            </p>
            <ul className="text-muted-foreground">
              {absence.extensions.map((extension) => (
                <li key={extension.recordedOn}>
                  du {extension.previousEnd} au {extension.newEnd}, enregistré le{" "}
                  {extension.recordedOn}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {absence.proofDueOn && !absence.proofReceivedOn ? (
          <p className="text-muted-foreground">Justificatif attendu pour le {absence.proofDueOn}.</p>
        ) : null}
        {absence.proofReceivedOn ? (
          <p className="text-muted-foreground">Justificatif reçu le {absence.proofReceivedOn}.</p>
        ) : null}
        {cancelled ? (
          <p className="text-muted-foreground">Annulée le {absence.cancelledOn}.</p>
        ) : null}

        {notice ? (
          <p className="rounded-md border border-dashed p-3 text-muted-foreground">{notice}</p>
        ) : cancelled ? null : (
          <div className="space-y-3 border-t border-border pt-3">
            {/* Le geste qui remplace la « fin inconnue » : on enregistre la date
                du papier, et on la repousse le jour où un second papier arrive. */}
            {extending ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-sm">
                  Prolonger jusqu’au
                  <input
                    type="date"
                    min={absence.end}
                    value={newEnd}
                    onChange={(event) => setNewEnd(event.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm"
                  />
                </label>
                <Button
                  size="sm"
                  disabled={newEnd <= absence.end}
                  onClick={() => {
                    void onExtend(absence.id, newEnd)
                    setExtending(false)
                  }}
                >
                  Enregistrer la prolongation
                </Button>
                <Button variant="outline" size="sm" onClick={() => setExtending(false)}>
                  Annuler
                </Button>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {extending ? null : (
                <Button variant="outline" size="sm" onClick={() => setExtending(true)}>
                  Prolonger
                </Button>
              )}
              {absence.proofDueOn && !absence.proofReceivedOn ? (
                <Button variant="outline" size="sm" onClick={() => onProofReceived(absence.id)}>
                  Justificatif reçu
                </Button>
              ) : null}
              <Button variant="destructive" size="sm" onClick={() => onCancelAbsence(absence.id)}>
                Annuler l’absence
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
