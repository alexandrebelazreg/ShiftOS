"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/layout/page-header"
import { createSupabaseBrowserClient } from "@/features/auth/supabase/browser"
import { importSnapshot, type ImportStep } from "@/features/migration/import"
import {
  isEmpty,
  readLocalSnapshot,
  summarize,
  type LocalSnapshot,
  type SnapshotCount,
} from "@/features/migration/local-data"

/**
 * La reprise, vue du gérant.
 *
 * Elle montre AVANT d'agir. Une reprise qui se lance seule et rend un « c'est
 * fait » ne dit ni ce qu'elle a trouvé ni ce qu'elle a laissé — et c'est
 * précisément ce qu'on veut vérifier quand il s'agit d'un an de travail.
 *
 * Rien n'est effacé du navigateur. La copie ne retire pas la source : tant que
 * la base n'a pas été vérifiée, l'ancien poste reste un filet.
 */
export function MigrationView() {
  const [snapshot, setSnapshot] = useState<LocalSnapshot | null>(null)
  const [counts, setCounts] = useState<SnapshotCount[]>([])
  const [steps, setSteps] = useState<ImportStep[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === "undefined") return
    // Différé d'un tour : la lecture du stockage est instantanée, mais la poser
    // pendant l'effet déclenche un rendu en cascade. C'est le même report que
    // les autres écrans de ShiftOS emploient pour la même raison.
    queueMicrotask(() => {
      const found = readLocalSnapshot(window.localStorage)
      setSnapshot(found)
      setCounts(summarize(found))
    })
  }, [])

  async function run() {
    if (!snapshot) return
    setRunning(true)
    setFailure(null)
    setSteps([])
    try {
      // Les étapes s'affichent au fur et à mesure : une reprise qui dure et ne
      // dit rien laisse croire qu'elle a planté.
      await importSnapshot(createSupabaseBrowserClient(), snapshot, (step) =>
        setSteps((current) => [...current, step])
      )
      setDone(true)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning(false)
    }
  }

  const nothingToDo = snapshot !== null && isEmpty(snapshot)
  const failed = steps.filter((step) => step.error)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reprise des données"
        description="Ce que ce navigateur détient est copié dans la base, pour être partagé entre vos appareils."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ce qui a été trouvé sur ce poste</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {snapshot === null ? (
            <p className="text-sm text-muted-foreground">Lecture…</p>
          ) : nothingToDo ? (
            <p className="text-sm text-muted-foreground">
              Ce navigateur ne contient aucune donnée à reprendre. Si votre travail se trouve
              sur un autre poste, ouvrez cette page depuis celui-là.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              {counts.map((entry) => (
                <div key={entry.label}>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {entry.label}
                  </dt>
                  <dd className="font-mono text-lg tabular-nums">{entry.count}</dd>
                </div>
              ))}
            </dl>
          )}

          {!nothingToDo && snapshot !== null ? (
            <Button onClick={run} disabled={running || done}>
              {running ? "Copie en cours…" : done ? "Copie terminée" : "Copier dans la base"}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {steps.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ce qui est parti</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {steps.map((step) => (
                <li key={step.label} className="flex items-baseline justify-between gap-4">
                  <span>{step.label}</span>
                  <span
                    className={
                      step.error ? "font-mono text-destructive" : "font-mono tabular-nums"
                    }
                  >
                    {step.error ? "échec" : step.written}
                  </span>
                </li>
              ))}
            </ul>

            {failed.length > 0 ? (
              <div
                role="alert"
                className="mt-4 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {failed.map((step) => (
                  <p key={step.label}>
                    <strong>{step.label}</strong> : {step.error}
                  </p>
                ))}
              </div>
            ) : null}

            {done && failed.length === 0 ? (
              <p className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                Tout est en base. Vos données restent aussi dans ce navigateur : ne l’effacez
                pas avant d’avoir vérifié depuis un autre appareil.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {failure ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          La copie s’est interrompue : {failure}. Relancez-la — ce qui est déjà passé sera
          simplement réécrit, jamais dupliqué.
        </div>
      ) : null}
    </div>
  )
}
