"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Check, CircleDashed, Save } from "lucide-react"

import { cn } from "@/lib/utils"
import type { IsoDate } from "@/features/core/models"
import {
  buildPlanningWeekStatuses,
  type PlanningWeekSector,
  type PlanningWeekState,
} from "@/features/planning/dashboard/planning-week-status"
import { createSetupRepository } from "@/features/onboarding/setup-repository"
import {
  planningStore,
  type PlanningSummary,
} from "@/features/planning/persistence"

const STATE_UI = {
  untreated: {
    label: "Non traité",
    icon: CircleDashed,
    className: "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70",
    dotClassName: "bg-muted-foreground/60",
  },
  partial: {
    label: "Partiel",
    icon: Save,
    className: "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60",
    dotClassName: "bg-amber-500",
  },
  posted: {
    label: "Affiché",
    icon: Check,
    className: "border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60",
    dotClassName: "bg-emerald-500",
  },
} satisfies Record<PlanningWeekState, {
  readonly label: string
  readonly icon: typeof CircleDashed
  readonly className: string
  readonly dotClassName: string
}>

export function PlanningWeekStatusStrip({ today }: { readonly today: IsoDate }) {
  const [plannings, setPlannings] = useState<readonly PlanningSummary[]>([])
  const [sectors, setSectors] = useState<readonly PlanningWeekSector[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  /** La seule semaine dont la liste de manquants est dépliée, ou aucune. */
  const [expanded, setExpanded] = useState<string | null>(null)
  const weeks = useMemo(
    () => buildPlanningWeekStatuses(today, plannings, sectors),
    [plannings, sectors, today]
  )

  // Les rayons actifs seuls : un rayon archivé n'est plus à traiter, et
  // l'attendre peindrait en jaune des semaines pourtant terminées.
  useEffect(() => {
    let active = true
    void createSetupRepository()
      .listSectors()
      .then((list) => {
        if (!active) return
        setSectors(
          list
            .filter((sector) => sector.status === "active")
            .map((sector) => ({ id: sector.id, name: sector.name }))
        )
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void planningStore.list()
      .then((items) => {
        if (active) setPlannings(items)
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
    <section aria-labelledby="planning-horizon-title" className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="planning-horizon-title" className="font-heading text-base font-medium">
          Suivi des plannings
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            jusqu’à S+6 · cliquez pour ouvrir
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground" aria-label="Légende">
          {(Object.keys(STATE_UI) as PlanningWeekState[]).map((state) => (
            <span key={state} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", STATE_UI[state].dotClassName)} aria-hidden="true" />
              {STATE_UI[state].label}
            </span>
          ))}
        </div>
      </div>

      {loadError ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Impossible de charger le suivi des plannings.
        </p>
      ) : (
        <div className="overflow-x-auto pb-1">
          <div className="grid min-w-[52rem] grid-cols-7 gap-2" aria-busy={loading}>
            {weeks.map((week) => {
              const ui = STATE_UI[week.state]
              const Icon = ui.icon
              const params = new URLSearchParams({ week: week.weekStart })
              if (week.planningId) params.set("planningId", week.planningId)

              return (
                /* LE LIEN COUVRE LA CARTE, SANS ENVELOPPER LE BOUTON.
                   Un bouton imbriqué dans un lien est un HTML invalide : le
                   navigateur en fait ce qu'il veut, et le clavier ne sait plus
                   lequel des deux il active. Le lien est donc étiré en fond, et
                   le contenu passe par-dessus — celui qui ne se clique pas
                   laisse traverser, celui qui se clique s'élève. */
                <div
                  key={week.weekStart}
                  className={cn(
                    "group relative rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring",
                    ui.className,
                    loading && "animate-pulse pointer-events-none"
                  )}
                >
                  <Link
                    href={`/planning?${params.toString()}`}
                    className="absolute inset-0 rounded-lg focus-visible:outline-none"
                    aria-label={
                      week.missingSectors.length > 0 && week.postedSectors.length > 0
                        ? `Semaine ${week.weekNumber}, ${ui.label}, reste à faire : ${week.missingSectors.join(", ")}`
                        : `Semaine ${week.weekNumber}, ${ui.label}`
                    }
                  />
                  <div className="pointer-events-none relative">
                    <span className="flex items-start justify-between gap-2">
                      <span>
                        <span className="block text-xs font-medium opacity-75">{week.offsetLabel}</span>
                        <span className="mt-0.5 block text-lg font-semibold">S{week.weekNumber}</span>
                      </span>
                      <Icon className="size-4 opacity-75" aria-hidden="true" />
                    </span>
                    <span className="mt-2 block text-xs tabular-nums opacity-75">{week.rangeLabel}</span>
                    <span className="mt-1 block text-xs font-medium">{ui.label}</span>
                  </div>

                  {/* UN SEUL NOM, PUIS TROIS POINTS.
                      Les huit rayons écrits en toutes lettres faisaient cinq
                      lignes par carte et repoussaient les absences sous la
                      ligne de flottaison — pour une liste qu'on ne lit pas au
                      coup d'œil, mais quand on cherche déjà quoi faire. Le
                      premier nom suffit à dire « il en manque » ; les trois
                      points disent combien, et les donnent au clic. */}
                  {week.missingSectors.length > 0 && week.postedSectors.length > 0 ? (
                    expanded === week.weekStart ? (
                      <button
                        type="button"
                        onClick={() => setExpanded(null)}
                        className="relative mt-1 block w-full text-left text-xs opacity-75 hover:opacity-100"
                      >
                        Manque : {week.missingSectors.join(", ")}
                      </button>
                    ) : (
                      /* Le nom se tronque, le compteur JAMAIS. Sur une seule
                         ligne tronquée, c'est le compteur — placé en fin — que
                         le navigateur coupait en premier : il ne restait qu'un
                         nom sectionné, et rien ne disait qu'il en manquait six
                         autres. Le nom rétrécit donc seul, le compteur ne
                         rétrécit pas. */
                      <p className="relative mt-1 flex items-baseline gap-1 text-xs opacity-75">
                        <span className="min-w-0 truncate">
                          Manque : {week.missingSectors[0]}
                        </span>
                        {week.missingSectors.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => setExpanded(week.weekStart)}
                            title={week.missingSectors.join(", ")}
                            aria-label={`Voir les ${week.missingSectors.length} rayons manquants`}
                            className="shrink-0 rounded px-1 font-semibold underline underline-offset-2 hover:bg-foreground/10"
                          >
                            +{week.missingSectors.length - 1}
                          </button>
                        ) : null}
                      </p>
                    )
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
