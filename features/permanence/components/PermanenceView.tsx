"use client"

import { ChevronLeft, ChevronRight, Printer, Wand2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { PageHeader } from "@/components/layout/page-header"
import { Button } from "@/components/ui/button"
import type { IsoDate, WeekDay } from "@/features/core/models"
import { weekDayOf } from "@/features/core/shared"
import { absenceService } from "@/features/absences/services/absence.service"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { validatedPaidLeaveAbsences } from "@/features/paid-leave/dashboard/validated-paid-leave"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import { createPaidLeaveRepository } from "@/features/paid-leave/persistence/paid-leave-repository"
import { createHolidayRepository, type StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { defaultHolidaySchedules } from "@/features/planning/holidays/model/holiday-schedule"
import {
  buildPermanenceCalendar,
  MONTH_LABELS,
  type PermanenceHoliday,
} from "@/features/permanence/calendar/permanence-calendar"
import { PermanenceMonthGrid } from "@/features/permanence/components/PermanenceMonthGrid"
import { PermanenceRecapTable } from "@/features/permanence/components/PermanenceRecapTable"
import { PermanenceYearRecap } from "@/features/permanence/components/PermanenceYearRecap"
import { assign, toggleRest } from "@/features/permanence/domain/permanence-edits"
import { paidLeaveByWeek } from "@/features/permanence/domain/permanence-leave"
import {
  absentOn,
  permanenceRoster,
  type PermanenceMember,
} from "@/features/permanence/domain/permanence-roster"
import { generatePermanenceMonth } from "@/features/permanence/generation/generate-permanence-month"
import type { PermanenceLoad } from "@/features/permanence/models/permanence-load"
import {
  emptyPermanenceMonth,
  EMPTY_WEEK_SLOTS,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"
import { createPermanenceRepository } from "@/features/permanence/persistence/permanence-repository"
import { PermanenceSheet } from "@/features/permanence/publication/PermanenceSheet"
import { buildPermanenceSheet } from "@/features/permanence/publication/permanence-sheet"
import {
  buildPermanenceRecap,
  buildPermanenceYear,
} from "@/features/permanence/recap/permanence-recap"
import { storeOpensOn } from "@/features/store/lib/opening-days"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

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
  const [campaigns, setCampaigns] = useState<readonly PaidLeaveCampaign[]>([])
  const [sheet, setSheet] = useState<PermanenceMonth | null>(null)
  const [yearSheets, setYearSheets] = useState<readonly PermanenceMonth[]>([])

  const repository = useMemo(
    () => (typeof window === "undefined" ? null : createPermanenceRepository(window.localStorage)),
    []
  )
  const holidayRepository = useMemo(
    () => (typeof window === "undefined" ? null : createHolidayRepository(window.localStorage)),
    []
  )

  useEffect(() => {
    if (!holidayRepository) return
    queueMicrotask(() => {
      setHolidays(holidayRepository.read())
      // Les congés viennent de leur propre écran : la permanence les LIT, pour
      // remplir sa colonne « CP » et pour ne confier les clés à personne qui
      // soit en vacances cette semaine-là.
      setCampaigns(createPaidLeaveRepository(window.localStorage).list())
    })
    absenceService.list().then(setAbsences)
  }, [holidayRepository])

  // Le mois affiché et l'année entière se relisent ensemble : le récapitulatif
  // annuel et le passif du générateur viennent tous deux des mois voisins.
  useEffect(() => {
    if (!repository) return
    queueMicrotask(() => {
      setSheet(repository.get(year, month) ?? emptyPermanenceMonth(year, month, new Date().toISOString()))
      setYearSheets(repository.year(year))
    })
  }, [repository, year, month])

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

  /** La colonne « CP » : qui part en congés, semaine par semaine. */
  const leaveByWeek = useMemo(() => paidLeaveByWeek(campaigns), [campaigns])

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

  const recap = useMemo(
    () => buildPermanenceRecap(sheet ? [sheet] : [], roster),
    [sheet, roster]
  )
  const yearRows = useMemo(() => buildPermanenceYear(yearSheets, roster), [yearSheets, roster])

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
            storeName: initialStore?.name ?? "Magasin",
            printedAtLabel: `Imprimé le ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date())}`,
          })
        : null,
    [sheet, calendar, roster, leaveByWeek, initialStore]
  )

  /** Écrire le mois, et l'écrire une seule fois — l'état et le dépôt ne divergent pas. */
  const write = useCallback(
    (next: PermanenceMonth) => {
      const stamped = { ...next, updatedAt: new Date().toISOString() }
      repository?.save(stamped)
      setSheet(stamped)
      setYearSheets((current) => {
        const others = current.filter((entry) => entry.id !== stamped.id)
        return [...others, stamped].sort((left, right) => left.month - right.month)
      })
    },
    [repository]
  )

  const generate = () => {
    if (!sheet) return
    const result = generatePermanenceMonth({
      calendar,
      roster,
      // Absences saisies ET congés validés : les deux disent la même chose au
      // générateur — cette personne n'est pas là pour ouvrir le magasin.
      unavailableOn: (date) => absentOn(unavailabilities, date),
      history: historyBefore(yearSheets, month, roster),
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
        onAssign={(date, role, employeeId) => write(assign(sheet, date, role, employeeId))}
        onToggleRest={(date, employeeId) => write(toggleRest(sheet, date, employeeId))}
        onOnCall={setOnCall}
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

/**
 * Ce que chacun a porté depuis janvier, avant le mois qu'on génère.
 *
 * Les mois SUIVANTS sont volontairement ignorés : régénérer mars ne doit pas
 * dépendre de ce qu'on avait déjà posé en avril, sinon la même commande rendrait
 * deux résultats différents selon l'ordre dans lequel l'année a été remplie.
 */
function historyBefore(
  sheets: readonly PermanenceMonth[],
  month: number,
  roster: readonly PermanenceMember[]
): Readonly<Record<string, PermanenceLoad>> {
  const recap = buildPermanenceRecap(
    sheets.filter((sheet) => sheet.month < month),
    roster
  )
  return Object.fromEntries(recap.rows.map((row) => [row.employeeId, row.load]))
}
