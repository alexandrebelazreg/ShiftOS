"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"
import { cn } from "@/lib/utils"

import { weekDayOf } from "@/features/core/shared"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { adaptEditorStateToBoard } from "@/features/planning/board"
import type { StoredHolidays } from "@/features/planning/holidays/holiday.repository"
import { holidayStore } from "@/features/planning/holidays/holiday.store"
import { frenchHolidaysOf } from "@/features/planning/holidays/model/french-holidays"
import { holidayPlanForPeriod } from "@/features/planning/holidays/model/holiday-plan"
import { isoWeekNumber } from "@/features/planning/board/model/week"
import {
  planningStore,
  type PlanningRecord,
  type PlanningSummary,
} from "@/features/planning/persistence"
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
  const [affichables, setAffichables] = useState<readonly PlanningSummary[] | null>(null)
  const [record, setRecord] = useState<PlanningRecord | null>(null)
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

  // La liste des plannings affichables, le plus récent en premier.
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
      .list()
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
         *
         * Un enregistrement EXISTE parce que quelqu'un a cliqué « Enregistrer ».
         * C'est le geste qui rend un rayon affichable, et il n'y en a plus
         * d'autre à attendre.
         */
        setAffichables(all)
      })
      .catch(() => {
        if (active) setError("Impossible de lire les plannings enregistrés.")
      })
    return () => {
      active = false
    }
  }, [])

  // Le premier planning s'ouvre de lui-même : arriver sur cet écran,
  // c'est vouloir imprimer, pas choisir dans une liste d'un seul élément.
  const selectedId = record?.id ?? null
  useEffect(() => {
    const first = affichables?.[0]
    if (!first || selectedId !== null) return
    void open(first.id)
    // `open` est stable pour ce composant ; la dépendance utile est la liste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affichables])

  async function open(id: string) {
    setError(null)
    try {
      const reopened = await planningStore.reopen(id)
      if (!reopened) throw new Error("Planning introuvable.")
      setRecord(reopened)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible d’ouvrir ce planning.")
    }
  }

  /**
   * Le planning choisi, relu comme la grille le lit.
   *
   * Les rayons viennent du RECORD, pas d'une sélection d'écran : une semaine
   * enregistrée a été planifiée pour un périmètre précis, et c'est celui-là qu'on
   * affiche — même si la configuration a gagné un rayon depuis.
   */
  const boardInput = useMemo(() => {
    if (!record) return null
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
  }, [record, setup.sectors, initialStore, employees, storedHolidays])

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          title="Affichage"
          description="Imprimez un planning enregistré pour l’affichage officiel du magasin."
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive print:hidden">
          {error}
        </p>
      ) : null}

      {affichables === null || setup.isLoading ? (
        <p className="text-sm text-muted-foreground print:hidden">Chargement…</p>
      ) : affichables.length === 0 ? (
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
      ) : (
        <>
          {/* Le sélecteur ne s'affiche qu'à partir de deux semaines : sur une
              seule il n'offrirait aucun choix et repousserait la feuille. */}
          {affichables.length > 1 ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              {affichables.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void open(entry.id)}
                  aria-pressed={entry.id === selectedId}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition",
                    entry.id === selectedId
                      ? "border-primary bg-primary/10 font-medium"
                      : "hover:bg-muted"
                  )}
                >
                  {weekButtonLabel(entry)}
                </button>
              ))}
            </div>
          ) : null}

          {boardInput ? (
            <PlanningPublicationPanel
              // Changer de semaine REMONTE le panneau : les rayons et les jours
              // cochés appartiennent à la semaine qu'on regardait, pas à celle-ci.
              key={record?.id}
              input={boardInput}
              sectorIds={boardInput.sectors.map((sector) => sector.id)}
              storeName={initialStore?.name ?? "Magasin"}
              storeCity={initialStore?.city ?? null}
              draft={false}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

/** « Semaine 33 · 10/08 → 16/08 » — ce qu'un gérant navigue par. */
function weekButtonLabel(entry: PlanningSummary): string {
  return `Semaine ${isoWeekNumber(entry.periodStart)} · ${short(entry.periodStart)} → ${short(entry.periodEnd)}`
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
