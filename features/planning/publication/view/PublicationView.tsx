"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"

import type { IsoDate } from "@/features/core/models"
import { weekDayOf } from "@/features/core/shared"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { adaptEditorStateToBoard, type PlanningBoardInput } from "@/features/planning/board"
import type { StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { holidayStore } from "@/features/planning/holidays/holiday.store"
import { frenchHolidaysOf } from "@/features/planning/holidays/model/french-holidays"
import { holidayPlanForPeriod } from "@/features/planning/holidays/model/holiday-plan"
import { isoWeekNumber } from "@/features/planning/board/model/week"
import {
  planningStore,
  type PlanningRecord,
} from "@/features/planning/persistence"
import type { PublicationWeek } from "@/features/planning/publication/model/employee-document"
import { latestPerSectorScope } from "@/features/planning/publication/model/latest-plannings"
import { mergeBoardInputs } from "@/features/planning/publication/model/merge-board-inputs"
import { PlanningPublicationPanel } from "@/features/planning/publication/ui/PlanningPublicationPanel"
import { useSetupReadiness } from "@/features/onboarding"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

/**
 * L'écran d'affichage : ce qui part au mur.
 *
 * Il montrait les seuls plannings PUBLIÉS, la publication étant l'acte qui
 * figeait une semaine. Cet acte n'existe plus : enregistrer un rayon suffit
 * désormais à le rendre affichable, et il n'y a plus de second geste à faire
 * avant d'imprimer. Un rayon n'attend pas les autres — le Drive peut partir au
 * mur pendant que la zone marché se termine.
 *
 * Ce que cela coûte, et qui est assumé : rien ne distingue plus une semaine
 * arrêtée d'une semaine encore en cours de retouche. C'est au gérant de savoir
 * ce qu'il punaise ; l'écran ne le décide plus à sa place.
 *
 * Elle ne modifie rien : ni enregistrement, ni régénération, ni retouche. On y
 * choisit un planning, une mise en page, et on imprime.
 */
export function PublicationView({ initialStore }: { readonly initialStore: StoreConfig | null }) {
  const setup = useSetupReadiness(initialStore)
  const { employees } = useEmployees()
  /**
   * TOUS les plannings, états complets compris.
   *
   * `list()` ne rendait que des résumés, ce qui suffisait tant qu'on n'ouvrait
   * qu'une semaine à la fois. Deux demandes ont changé cela : montrer sur la
   * feuille d'un comptoir les heures faites AILLEURS, et suivre quelqu'un sur
   * plusieurs semaines. Les deux exigent d'avoir sous la main les plannings des
   * autres rayons et des autres semaines, donc leurs états.
   */
  const [records, setRecords] = useState<readonly PlanningRecord[] | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Les fériés que la feuille doit dire.
   *
   * Lus dans un état plutôt qu'au rendu : la source est devenue la base. Sans
   * cette conversion, la valeur passée au calcul était une PROMESSE — et
   * TypeScript ne pouvait pas s'en apercevoir, `StoredHolidays` étant indexé par
   * des dates dont une promesse ne porte évidemment aucune. Le type était
   * satisfait par le vide, et le mur aurait présenté chaque férié comme un jour
   * ordinaire.
   */
  const [storedHolidays, setStoredHolidays] = useState<StoredHolidays>({})

  useEffect(() => {
    let active = true
    void holidayStore.read().then((stored) => {
      if (active) setStoredHolidays(stored)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void planningStore
      .records()
      .then((all) => {
        if (!active) return
        /**
         * TOUT CE QUI EST ENREGISTRÉ EST AFFICHABLE.
         *
         * Le filtre ne gardait que `published`. La publication ayant disparu
         * de l'écran de planning, ce filtre ne laissait plus rien passer et
         * cette page serait restée vide pour toujours — sans une erreur, sans
         * un mot : la liste vide est exactement ce que voit un magasin qui
         * n'a encore rien planifié.
         */
        setRecords(all)
      })
      .catch(() => {
        if (active) setError("Impossible de lire les plannings enregistrés.")
      })
    return () => {
      active = false
    }
  }, [])

  /**
   * Les semaines affichables, chacune RÉUNIE de ses plannings.
   *
   * Une semaine ne se génère pas d'un coup : le Drive part seul, la zone marché
   * ensemble. Groupés ici par lundi puis fusionnés, ils redeviennent la semaine
   * telle que l'équipe la vit — et c'est la seule forme sous laquelle la feuille
   * peut dire à quelqu'un TOUTES ses heures.
   */
  const weeks = useMemo<readonly PublicationWeek[]>(() => {
    if (!records) return []
    const byWeek = new Map<string, PlanningRecord[]>()
    for (const record of records) {
      const list = byWeek.get(record.periodStart)
      if (list) list.push(record)
      else byWeek.set(record.periodStart, [record])
    }

    return [...byWeek.entries()]
      // La plus récente en tête : c'est celle qu'on vient afficher.
      .sort(([left], [right]) => right.localeCompare(left))
      .flatMap(([weekStart, group]) => {
        const merged = mergeBoardInputs(
          // Un seul enregistrement par périmètre : régénérer un rayon en crée
          // un nouveau à côté du précédent, et les réunir tous compterait
          // chaque vacation autant de fois qu'on a régénéré.
          latestPerSectorScope(group).flatMap((record) => {
            const input = boardInputOf(record)
            return input ? [input] : []
          })
        )
        return merged ? [{ weekStart: weekStart as IsoDate, label: weekLabelOf(merged), input: merged }] : []
      })
    // `boardInputOf` ne dépend que de ce qui suit ; l'extraire en dépendance
    // ferait recalculer toutes les semaines à chaque frappe de l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, setup.sectors, initialStore, employees, storedHolidays])

  /**
   * Le PREMIER rayon de chaque fiche, en identifiants.
   *
   * La fiche employé range ses rayons PAR NOM et dans un ordre que le gérant
   * choisit avec des flèches : le premier est donc un choix, pas un hasard. La
   * feuille de comptoir s'en sert pour garder son équipe à l'affiche même en
   * vacances. La traduction nom → identifiant se fait ici, une fois.
   */
  const primarySectorByEmployee = useMemo(() => {
    const idByName = new Map((setup.sectors ?? []).map((sector) => [sector.name, sector.id]))
    return Object.fromEntries(
      employees.map((employee) => [
        employee.id,
        idByName.get(employee.sectors?.[0] ?? "") ?? null,
      ])
    )
  }, [employees, setup.sectors])

  /**
   * La semaine regardée : celle qu'on a choisie, ou la plus récente.
   *
   * DÉRIVÉE, et non posée dans un effet. Un effet qui aurait écrit le premier
   * choix aurait rendu deux fois à chaque arrivée, et surtout il aurait fallu
   * qu'il se redéclenche quand la liste change — un état qui court après une
   * liste qu'il ne contrôle pas. Ici `null` veut simplement dire « je n'ai rien
   * choisi », et le repli répond à sa place.
   */
  const current = weeks.find((week) => week.weekStart === selectedWeek) ?? weeks[0] ?? null

  /**
   * Un planning enregistré, relu comme la grille le lit.
   *
   * Les rayons viennent du RECORD, pas d'une sélection d'écran : une semaine
   * enregistrée a été planifiée pour un périmètre précis, et c'est celui-là
   * qu'on affiche — même si la configuration a gagné un rayon depuis.
   *
   * Déclarée en fonction plutôt qu'en mémo : elle tourne une fois par
   * enregistrement, et il y en a autant que de rayons × semaines.
   */
  function boardInputOf(record: PlanningRecord) {
    const scope = record.sectorIds ?? record.state.sectorScope?.sectorIds ?? null
    const sectors = (setup.sectors ?? [])
      .filter((sector) => scope === null || scope.includes(sector.id))
      .map((sector) => ({
        id: sector.id,
        name: sector.name,
        marketZone: sector.marketZone,
        hours: sector.hours,
        color: sector.color,
      }))
    // Les fériés voyagent avec la feuille : ce que la grille dit d'une journée
    // fériée, le mur doit le dire aussi, avec les mêmes mots.
    const period = { start: record.state.planning.periodStart, end: record.state.planning.periodEnd }
    const holidays = holidayPlanForPeriod(period, storedHolidays, (date) => {
      const day = initialStore?.openingHours.find((hours) => hours.day === weekDayOf(date))
      return day && !day.closed && day.opensAt && day.closesAt
        ? { opensAt: day.opensAt, closesAt: day.closesAt }
        : null
    })
    const sunday = initialStore?.openingHours.find((hours) => hours.day === "sunday")

    return adaptEditorStateToBoard(
      record.state,
      sectors,
      undefined,
      holidays.length === 0
        ? undefined
        : {
            holidays: holidays.map((entry) => ({
              date: entry.date,
              name: holidayNameOf(entry.date),
              opening: entry.opening,
              volunteerIds: entry.volunteerIds,
            })),
            storeOpensSundays: sunday !== undefined && !sunday.closed,
            profiles: Object.fromEntries(
              employees.map((employee) => [
                employee.id,
                {
                  scheduleType: employee.scheduleType,
                  student: employee.student,
                  forfaitJour: employee.forfaitJour,
                  fixedRestDays: employee.fixedDaysOff,
                },
              ])
            ),
          }
    )
  }

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        {/* Sans sous-titre : chaque onglet dit déjà ce qu'il produit, une
            ligne plus bas. Le répéter ici coûtait une ligne pour rien. */}
        <PageHeader title="Affichage" />
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive print:hidden">
          {error}
        </p>
      ) : null}

      {records === null || setup.isLoading ? (
        <p className="text-sm text-muted-foreground print:hidden">Chargement…</p>
      ) : weeks.length === 0 ? (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-base">Aucun planning enregistré</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Un rayon devient affichable dès qu’il est enregistré. Générez une semaine
              et enregistrez-la pour pouvoir l’imprimer.
            </p>
            <Button variant="outline" size="sm" render={<Link href="/planning" />}>
              Aller au planning
            </Button>
          </CardContent>
        </Card>
      ) : current ? (
        <PlanningPublicationPanel
          // Changer de semaine REMONTE le panneau : les rayons et les jours
          // cochés appartiennent à la semaine qu'on regardait, pas à celle-ci.
          key={current.weekStart}
          input={current.input}
          sectorIds={current.input.sectors.map((sector) => sector.id)}
          weeks={weeks}
          selectedWeek={current.weekStart}
          onSelectWeek={setSelectedWeek}
          employees={employees.map((employee) => ({
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`.trim(),
          }))}
          primarySectorByEmployee={primarySectorByEmployee}
          storeName={initialStore?.name ?? "Magasin"}
          storeCity={initialStore?.city ?? null}
          draft={false}
        />
      ) : null}
    </div>
  )
}

/** « S36 · 31/08 → 06/09 » — ce qu'un gérant navigue par, et ce qu'une ligne porte. */
function weekLabelOf(input: PlanningBoardInput): string {
  return `S${isoWeekNumber(input.periodStart)} · ${short(input.periodStart)} → ${short(input.periodEnd)}`
}

/** Le nom du férié qui tombe à cette date, ou la date à défaut. */
function holidayNameOf(date: string): string {
  const year = Number(date.slice(0, 4))
  return frenchHolidaysOf(year).find((holiday) => holiday.date === date)?.name ?? date
}

function short(date: string): string {
  const [, month, day] = date.split("-")
  return `${day}/${month}`
}
