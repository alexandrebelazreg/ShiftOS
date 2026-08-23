"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"
import { SPLIT_SHIFT_DETAIL_POLICIES } from "@/features/core/models"
import { useEmployees } from "@/features/employees/hooks/useEmployees"
import { createSetupRepository } from "@/features/onboarding/setup-repository"
import {
  evaluateSetupReadiness,
  type SetupSector,
} from "@/features/onboarding/setup-readiness"
import { StoreForm } from "@/features/store/components/StoreForm"
import {
  countryLabel,
  planningModeLabel,
  splitShiftPolicyLabel,
  timezoneLabel,
  WEEK_DAY_LABELS,
} from "@/features/store/lib/constants"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

/** Readable summary and shared edit entry point for the persisted store. */
export function StoreConfigurationView({ store }: { readonly store: StoreConfig }) {
  const router = useRouter()
  const { employees } = useEmployees()
  const [sectors, setSectors] = useState<readonly SetupSector[]>([])
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    queueMicrotask(() => {
      void createSetupRepository().listSectors().then(setSectors)
    })
  }, [])

  if (isEditing) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Modifier le magasin"
          description="Les mêmes rubriques que lors de la configuration initiale, avec les valeurs enregistrées."
        />
        <StoreForm
          initialStore={store}
          onSaved={() => {
            setIsEditing(false)
            router.refresh()
          }}
        />
      </div>
    )
  }

  const readiness = evaluateSetupReadiness({ store, employees, sectors })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title="Magasin"
          description="Identité, horaires et règles générales utilisées pour construire les plannings."
        />
        <Button onClick={() => setIsEditing(true)}>Modifier le magasin</Button>
      </div>

      {readiness.blockers.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="text-base">Configuration à compléter</CardTitle>
            <CardDescription>
              Ces éléments sont encore nécessaires avant de générer un planning complet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" render={<Link href="/configuration/secteurs" />}>
                Configurer les secteurs
              </Button>
              <Button size="sm" variant="outline" render={<Link href="/configuration/employes" />}>
                Configurer les employés
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <ConfigurationSection
          title="Identité et localisation"
          description="Coordonnées administratives et heure locale."
        >
          <Definition label="Nom du magasin" value={store.name} />
          <Definition label="Enseigne" value={store.brand || "Non renseignée"} />
          <Definition label="Adresse" value={`${store.address}, ${store.postalCode} ${store.city}`} />
          <Definition label="Pays" value={countryLabel(store.country)} />
          <Definition label="Fuseau horaire" value={timezoneLabel(store.timezone)} />
        </ConfigurationSection>

        <ConfigurationSection
          title="Horaires d’ouverture"
          description="Semaine complète du magasin."
        >
          {store.openingHours.map((day) => (
            <div key={day.day} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-medium">{WEEK_DAY_LABELS[day.day]}</span>
              {day.closed ? (
                <Badge variant="outline">Fermé</Badge>
              ) : (
                <span className="tabular-nums">{day.opensAt} – {day.closesAt}</span>
              )}
            </div>
          ))}
        </ConfigurationSection>

        <ConfigurationSection
          title="Création du planning"
          description="Méthode utilisée pour produire les services."
        >
          <Definition label="Mode" value={planningModeLabel(store.planningMode)} />
          <Definition
            label="Précision des horaires"
            value={store.timeGranularity ? `${store.timeGranularity} minutes` : "Non renseignée"}
          />
          <Definition
            label="Service généré minimum"
            value={formatMinutes(store.minShiftDuration)}
          />
        </ConfigurationSection>

        <ConfigurationSection
          title="Durées et limites de travail"
          description="Les deux maximums journaliers sont présentés séparément."
        >
          <div className="grid gap-3 py-2 sm:grid-cols-2">
            <LimitCard
              tone="continuous"
              label="Maximum en continu"
              value={formatMinutes(store.maxShiftDuration)}
              description="Une seule plage, sans interruption."
            />
            <LimitCard
              tone="split"
              label="Maximum avec coupure"
              value={`${formatHours(store.maxDailyHours)} travaillées`}
              description="Cumul des plages, coupure exclue."
            />
          </div>
          <Definition label="Minimum travaillé par jour" value={formatHours(store.minDailyHours)} />
          <Definition label="Repos entre deux journées" value={formatHours(store.minRestBetweenShifts)} />
          <Definition
            label="Maximum hebdomadaire"
            value={store.maxWeeklyHoursOverride === undefined
              ? "Limite par défaut"
              : formatHours(store.maxWeeklyHoursOverride)}
          />
        </ConfigurationSection>

        <ConfigurationSection
          title="Journées avec coupure"
          description="Règle appliquée aux journées composées de deux plages."
          className="xl:col-span-2"
        >
          <Definition label="Politique" value={splitShiftPolicyLabel(store.splitShiftPolicy)} />
          {SPLIT_SHIFT_DETAIL_POLICIES.includes(store.splitShiftPolicy) ? (
            <>
              <Definition label="Coupure minimale" value={formatMinutes(store.minSplitDuration)} />
              <Definition label="Coupure maximale" value={formatMinutes(store.maxSplitDuration)} />
              <Definition
                label="Journées avec coupure par semaine"
                value={store.maxSplitShiftsPerWeek === undefined
                  ? "Non renseigné"
                  : `${store.maxSplitShiftsPerWeek} maximum par employé`}
              />
            </>
          ) : null}
        </ConfigurationSection>
      </div>
    </div>
  )
}

function ConfigurationSection({
  title,
  description,
  className,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly className?: string
  readonly children: React.ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">{children}</CardContent>
    </Card>
  )
}

function Definition({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function LimitCard({
  tone,
  label,
  value,
  description,
}: {
  readonly tone: "continuous" | "split"
  readonly label: string
  readonly value: string
  readonly description: string
}) {
  const toneClass = tone === "continuous"
    ? "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950/35 dark:text-sky-100"
    : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100"
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs font-medium opacity-75">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-1 text-xs opacity-75">{description}</p>
    </div>
  )
}

function formatMinutes(minutes: number | undefined): string {
  return minutes === undefined ? "Non renseigné" : formatHours(minutes / 60)
}

function formatHours(hours: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(hours)} h`
}
