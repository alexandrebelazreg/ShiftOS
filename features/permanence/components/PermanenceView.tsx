"use client"

import { ChevronLeft, ChevronRight, Printer, Wand2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import type { IsoDate, WeekDay } from "@/features/core/models"
import { weekDayOf } from "@/features/core/shared"
import {
  DEFAULT_ABSENCE_RULES,
  type AbsenceRules,
} from "@/features/absences/models/absence-rules"
import { absenceRulesStore } from "@/features/absences/persistence/absence-rules.store"
import { absenceService } from "@/features/absences/services/absence.service"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { validatedPaidLeaveAbsences } from "@/features/paid-leave/dashboard/validated-paid-leave"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import { paidLeaveStore } from "@/features/paid-leave/persistence/paid-leave.store"
import { type StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { holidayStore } from "@/features/planning/holidays/holiday.store"
import { defaultHolidaySchedules } from "@/features/planning/holidays/model/holiday-schedule"
import {
  buildPermanenceCalendar,
  MONTH_LABELS,
  type PermanenceHoliday,
} from "@/features/permanence/calendar/permanence-calendar"
import { PermanenceMonthGrid } from "@/features/permanence/components/PermanenceMonthGrid"
import { PermanenceRecapTable } from "@/features/permanence/components/PermanenceRecapTable"
import { PermanenceYearRecap } from "@/features/permanence/components/PermanenceYearRecap"
import { assign, awayOn, toggleRest } from "@/features/permanence/domain/permanence-edits"
import { paidLeaveByWeek } from "@/features/permanence/domain/permanence-leave"
import { absentOn, permanenceRoster } from "@/features/permanence/domain/permanence-roster"
import { trainingByDate, trainingDraft } from "@/features/permanence/domain/permanence-training"
import {
  historyBefore,
  previousMonths,
} from "@/features/permanence/generation/fairness-window"
import { generatePermanenceMonth } from "@/features/permanence/generation/generate-permanence-month"
import {
  emptyPermanenceMonth,
  EMPTY_WEEK_SLOTS,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"
import { permanenceStore } from "@/features/permanence/persistence/permanence.store"
import { SaveFailureBanner } from "@/components/feedback/save-failure-banner"
import { useSaveFailure } from "@/components/feedback/use-save-failure"
import { PermanenceSheet } from "@/features/permanence/publication/PermanenceSheet"
import { buildPermanenceSheet } from "@/features/permanence/publication/permanence-sheet"
import {
  buildPermanenceRecap,
  buildPermanenceYear,
} from "@/features/permanence/recap/permanence-recap"
import { storeOpensOn } from "@/features/store/lib/opening-days"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { usePrintedBy } from "@/features/auth/components/printed-by"
import { signPrintedLabel } from "@/features/core/shared"

/**
 * L'écran des permanences : un mois à la fois, et le compte de ce que chacun a
 * porté.
 *
 * UN MOIS, jamais une semaine. Une permanence se répartit sur un mois parce que
 * c'est la plus petite durée où l'équité se voit : sur une semaine, celui qui
 * ferme le samedi ferme le samedi, il n'y a rien à équilibrer. C'est aussi la
 * maille de la feuille Excel dont cet écran reprend la forme, et la maille à
 * laquelle l'équipe la lit.
 *
 * La génération PROPOSE. Chaque case reste modifiable, et le récapitulatif se
 * recalcule à la retouche : c'est ainsi qu'un gérant peut n'être pas d'accord
 * avec la répartition sans avoir à la refaire entière.
 */
export function PermanenceView({ initialStore }: { readonly initialStore: StoreConfig | null }) {
  const { employees, isLoading } = useEmployees()
  const today = useMemo(() => new Date(), [])
  const [year, setYear] = useState(() => today.getFullYear())
  const [month, setMonth] = useState(() => today.getMonth() + 1)
  const [holidays, setHolidays] = useState<StoredHolidays | null>(null)
  const [absences, setAbsences] = useState<readonly AbsenceRecord[]>([])
  const [absenceRules, setAbsenceRules] = useState<AbsenceRules>(DEFAULT_ABSENCE_RULES)
  const [campaigns, setCampaigns] = useState<readonly PaidLeaveCampaign[]>([])
  const [sheet, setSheet] = useState<PermanenceMonth | null>(null)
  const { failure, guard } = useSaveFailure()
  const [yearSheets, setYearSheets] = useState<readonly PermanenceMonth[]>([])
  /** Les deux mois qui précèdent le mois affiché : la mémoire du générateur. */
  const [priorSheets, setPriorSheets] = useState<readonly PermanenceMonth[]>([])
  useEffect(() => {
    if (typeof window === "undefined") return
    queueMicrotask(() => {
      void holidayStore.read().then(setHolidays)
      // Les congés viennent de leur propre écran : la permanence les LIT, pour
      // remplir sa colonne « CP » et pour ne confier les clés à personne qui
      // soit en vacances cette semaine-là.
      void paidLeaveStore.list().then(setCampaigns)
      // Une formation posée d'ici est une absence comme une autre : elle suit
      // les règles réglées dans les paramètres des absences.
      void absenceRulesStore.read().then(setAbsenceRules)
    })
    absenceService.list().then(setAbsences)
  }, [])

  // Le mois affiché, l'année entière et les deux mois précédents se relisent
  // ensemble : le récapitulatif annuel vient de l'année, le passif du
  // générateur des deux mois d'avant — qui sont dans l'année PRÉCÉDENTE quand
  // on génère janvier ou février.
  useEffect(() => {
        queueMicrotask(() => {
      void Promise.all(
        previousMonths(year, month).map((entry) => permanenceStore.get(entry.year, entry.month))
      ).then((found) =>
        setPriorSheets(found.filter((entry): entry is PermanenceMonth => entry !== null))
      )
      void permanenceStore
        .get(year, month)
        .then((found) =>
          setSheet(found ?? emptyPermanenceMonth(year, month, new Date().toISOString()))
        )
      void permanenceStore.year(year).then(setYearSheets)
    })
  }, [year, month])

  const opensOn = useCallback(
    (day: WeekDay): boolean => storeOpensOn(initialStore, day),
    [initialStore]
  )

  /**
   * Les onze fériés de l'année, résolus une fois.
   *
   * Une fois, et non à chaque case interrogée : les dates de Pâques et des trois
   * fériés qui en dépendent se calculent, et les recalculer trente-cinq fois par
   * rendu ne les changerait pas.
   */
  const holidayByDate = useMemo(() => {
    const schedules = defaultHolidaySchedules(year, (date) => {
      const entry = initialStore?.openingHours.find((hours) => hours.day === weekDayOf(date))
      if (!entry || entry.closed) return null
      return { opensAt: entry.opensAt, closesAt: entry.closesAt }
    })
    return new Map<IsoDate, PermanenceHoliday>(
      schedules.map((schedule) => [
        schedule.date,
        {
          name: schedule.name,
          // Le réglage du gérant l'emporte sur la proposition par défaut : c'est
          // l'écran des jours fériés qui décide si le rideau se lève.
          closed: (holidays?.[schedule.date]?.opening ?? schedule.opening) === "chome",
        },
      ])
    )
  }, [year, holidays, initialStore])

  const holidayOf = useCallback(
    (date: IsoDate): PermanenceHoliday | null => holidayByDate.get(date) ?? null,
    [holidayByDate]
  )

  const calendar = useMemo(
    () => buildPermanenceCalendar({ year, month, opensOn, holidayOf }),
    [year, month, opensOn, holidayOf]
  )

  const roster = useMemo(() => permanenceRoster(employees), [employees])

  /**
   * La colonne « CP » : qui part en congés, semaine par semaine.
   *
   * Les campagnes ET les absences au motif « congés payés » : une semaine posée
   * dans l'écran des absences retirait bien la personne du tour sans jamais
   * dire pourquoi sa case restait vide.
   */
  const leaveByWeek = useMemo(
    () => paidLeaveByWeek(campaigns, absences),
    [campaigns, absences]
  )

  /**
   * Tout ce qui empêche quelqu'un de porter les clés un jour donné.
   *
   * Les congés validés y rejoignent les absences saisies : les deux sont des
   * absences, et le générateur n'a pas à savoir de laquelle il s'agit.
   */
  const unavailabilities = useMemo(
    () => [...absences, ...validatedPaidLeaveAbsences(campaigns)],
    [absences, campaigns]
  )

  /** La ligne « Formation » : les absences à ce motif, journée par journée. */
  const trainings = useMemo(
    () =>
      trainingByDate(
        absences,
        calendar.weeks.flatMap((week) => week.days.filter((day) => day.inMonth).map((day) => day.date))
      ),
    [absences, calendar]
  )

  const recap = useMemo(
    () => buildPermanenceRecap(sheet ? [sheet] : [], roster),
    [sheet, roster]
  )
  const yearRows = useMemo(() => buildPermanenceYear(yearSheets, roster), [yearSheets, roster])
  /** Qui imprime : la feuille au mur le dira sous la date. */
  const printedBy = usePrintedBy()

  /**
   * La feuille qui part au mur.
   *
   * Construite en permanence plutôt qu'au clic sur « Imprimer » : c'est ce que
   * les règles d'impression cherchent dans le document, et une feuille montée
   * seulement au moment du clic n'existerait pas encore quand le navigateur
   * compose la page.
   */
  const printable = useMemo(
    () =>
      sheet
        ? buildPermanenceSheet({
            calendar,
            month: sheet,
            roster,
            paidLeaveByWeek: leaveByWeek,
            trainingByDate: trainings,
            storeName: initialStore?.name ?? "Magasin",
            printedAtLabel: signPrintedLabel(
              `Imprimé le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}`,
              printedBy
            ),
          })
        : null,
    [sheet, calendar, roster, leaveByWeek, trainings, initialStore, printedBy]
  )

  /** Écrire le mois, et l'écrire une seule fois — l'état et le dépôt ne divergent pas. */
  const write = useCallback(
    (next: PermanenceMonth) => {
      const stamped = { ...next, updatedAt: new Date().toISOString() }
      void guard(() => permanenceStore.save(stamped))
      setSheet(stamped)
      setYearSheets((current) => {
        const others = current.filter((entry) => entry.id !== stamped.id)
        return [...others, stamped].sort((left, right) => left.month - right.month)
      })
    },
    [guard]
  )

  /**
   * Le mois tel qu'il est À CET INSTANT.
   *
   * Poser une formation attend la base avant de vider les cases du jour ; une
   * retouche faite pendant cette attente serait effacée si l'on repartait du
   * mois tel qu'il était au clic.
   */
  const sheetRef = useRef(sheet)
  useEffect(() => {
    sheetRef.current = sheet
  }, [sheet])

  /**
   * Poser une formation : l'absence d'abord, la feuille ensuite.
   *
   * Dans cet ordre parce que l'absence est la vérité : si elle n'est pas
   * enregistrée, la personne garde ses cases plutôt que de les perdre pour une
   * formation qui n'existe nulle part.
   */
  const addTraining = async (date: IsoDate, employeeId: string) => {
    const today = new Date().toISOString().slice(0, 10)
    const written = await guard(() =>
      absenceService.create(trainingDraft(employeeId, date), today, absenceRules)
    )
    if (written === null) return
    setAbsences((current) => [...current, written])
    const current = sheetRef.current
    if (current) write(awayOn(current, date, employeeId))
  }

  /** Retirer une formation l'ANNULE : elle reste lisible, barrée, dans l'écran des absences. */
  const removeTraining = async (absenceId: string) => {
    const today = new Date().toISOString().slice(0, 10)
    const cancelled = await guard(() => absenceService.cancel(absenceId, today))
    if (cancelled === null) return
    setAbsences((current) =>
      current.map((absence) => (absence.id === cancelled.id ? cancelled : absence))
    )
  }

  const generate = () => {
    if (!sheet) return
    const result = generatePermanenceMonth({
      calendar,
      roster,
      // Absences saisies ET congés validés : les deux disent la même chose au
      // générateur — cette personne n'est pas là pour ouvrir le magasin.
      unavailableOn: (date) => absentOn(unavailabilities, date),
      history: historyBefore(priorSheets, year, month, roster),
    })
    write({
      ...sheet,
      assignments: result.assignments,
      rest: result.rest,
      generatedAt: new Date().toISOString(),
    })
  }

  const setOnCall = (weekKey: string, employeeId: string | null) => {
    if (!sheet) return
    const previous = sheet.weeks[weekKey] ?? EMPTY_WEEK_SLOTS
    write({
      ...sheet,
      weeks: { ...sheet.weeks, [weekKey]: { ...previous, onCallEmployeeId: employeeId } },
    })
  }

  const step = (delta: number) => {
    const shifted = month + delta
    if (shifted < 1) {
      setYear(year - 1)
      setMonth(12)
      return
    }
    if (shifted > 12) {
      setYear(year + 1)
      setMonth(1)
      return
    }
    setMonth(shifted)
  }

  if (isLoading || sheet === null || holidays === null) {
    return <PageHeader title="Permanences" description="Chargement…" />
  }

  return (
    <div className="space-y-6">
      <SaveFailureBanner failure={failure} what="Cette permanence" />
      <PageHeader
        title="Permanences"
        description="Qui ouvre et qui ferme le magasin, mois par mois, réparti à charge égale."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Mois précédent">
          <ChevronLeft />
        </Button>
        <p className="min-w-44 text-center text-lg font-semibold">{calendar.label}</p>
        <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Mois suivant">
          <ChevronRight />
        </Button>

        <Button className="ml-auto" onClick={generate} disabled={roster.length === 0}>
          <Wand2 />
          {sheet.generatedAt ? "Regénérer le mois" : "Générer le mois"}
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer />
          Imprimer / Enregistrer en PDF
        </Button>
      </div>

      {/* Ni avertissement ni bilan de génération au-dessus de la grille : ce qui
          manque se voit dans la grille, à la case vide, et le récapitulatif dit
          si la répartition est juste. Un bandeau de plus retarderait la seule
          chose qu'on vient lire. */}
      <PermanenceMonthGrid
        calendar={calendar}
        month={sheet}
        roster={roster}
        paidLeaveByWeek={leaveByWeek}
        trainingByDate={trainings}
        onAssign={(date, role, employeeId) => write(assign(sheet, date, role, employeeId))}
        onToggleRest={(date, employeeId) => write(toggleRest(sheet, date, employeeId))}
        onOnCall={setOnCall}
        onAddTraining={(date, employeeId) => void addTraining(date, employeeId)}
        onRemoveTraining={(absenceId) => void removeTraining(absenceId)}
      />

      <PermanenceRecapTable
        recap={recap}
        weekDays={calendar.weekDays}
        title={`Récapitulatif des fermetures — ${MONTH_LABELS[month - 1]} ${year}`}
      />

      <PermanenceYearRecap rows={yearRows} year={year} />

      {/* La feuille est MONTÉE mais invisible à l'écran.
          Montée, parce que les règles d'impression cherchent ce document au
          moment où le navigateur compose la page : une feuille construite au
          clic n'existerait pas encore. Invisible, parce que l'écran a déjà la
          grille et le récapitulatif — en afficher une seconde copie figée sous
          la première ne servirait qu'à faire défiler. */}
      {printable ? (
        <div className="hidden print:block">
          <PermanenceSheet sheet={printable} />
        </div>
      ) : null}
    </div>
  )
}
