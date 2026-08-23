"use client"

import { RotateCcw } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  SELECTABLE_ABSENCE_MOTIVES,
  HOURS_TREATMENTS,
  HOURS_TREATMENT_LABELS,
  type HoursTreatment,
} from "@/features/absences/models/absence-motive"
import {
  DEFAULT_ABSENCE_RULES,
  isModified,
  resolveMotive,
  withRule,
  type AbsenceRules,
} from "@/features/absences/models/absence-rules"
import { absenceRulesStore } from "@/features/absences/persistence/absence-rules.store"
import { cn } from "@/lib/utils"

/**
 * Le tableau des motifs d'absence, tel qu'il s'applique dans ce magasin.
 *
 * Chaque ligne est un motif ; deux colonnes se règlent, les heures et le papier
 * attendu. Le reste — le nom, le fait qu'un motif se compte en heures — n'est
 * pas une convention et ne s'y touche pas.
 *
 * Chaque modification est enregistrée IMMÉDIATEMENT, sans bouton « Valider » :
 * un écran de réglages qu'on quitte sans enregistrer est un écran où l'on croit
 * avoir changé la règle. La ligne modifiée se signale, et se remet seule à sa
 * valeur d'origine ; c'est ce qui remplace l'annulation.
 */
export function AbsenceRulesSettings() {
  const [rules, setRules] = useState<AbsenceRules>(DEFAULT_ABSENCE_RULES)
  const [ready, setReady] = useState(false)
  /**
   * L'enregistrement a échoué.
   *
   * Cet état n'existait pas tant que le stockage était local : écrire dans le
   * navigateur ne rate pas. Avec une base derrière un réseau, si — et un
   * réglage qu'on croit posé alors qu'il n'est pas parti est pire que pas de
   * réglage du tout.
   */
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    // La lecture part vers la base : `active` évite d'écrire dans un composant
    // démonté entre-temps, ce qu'un aller-retour instantané ne risquait pas.
    let active = true
    void absenceRulesStore.read().then((stored) => {
      if (!active) return
      setRules(stored)
      setReady(true)
    })
    return () => {
      active = false
    }
  }, [])

  function change(next: AbsenceRules) {
    setSaveFailed(false)
    // L'écran suit la saisie sans attendre l'enregistrement : un réglage qui
    // met un aller-retour à s'afficher donne l'impression de n'avoir pas été
    // pris. L'écriture suit, et son échec est signalé plutôt qu'avalé.
    setRules(next)
    void absenceRulesStore.save(next).catch(() => setSaveFailed(true))
  }

  function resetAll() {
    setSaveFailed(false)
    setRules(DEFAULT_ABSENCE_RULES)
    void absenceRulesStore.reset().catch(() => setSaveFailed(true))
  }

  const modifiedCount = SELECTABLE_ABSENCE_MOTIVES.filter((motive) =>
    isModified(rules, motive.value)
  ).length

  return (
    <Card>
      {saveFailed ? (
        <div
          role="alert"
          className="mx-6 mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Ce réglage n’a pas pu être enregistré. Vérifiez votre connexion, puis modifiez-le
          à nouveau.
        </div>
      ) : null}
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Règles des absences</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Ce que chaque motif fait aux heures, et le justificatif qu’il réclame. Modifiez
            seulement ce que votre convention traite autrement.
          </p>
        </div>
        {modifiedCount > 0 ? (
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw />
            Tout remettre par défaut
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {!ready ? (
          <p className="text-sm text-muted-foreground">Chargement des règles…</p>
        ) : (
          SELECTABLE_ABSENCE_MOTIVES.map((motive) => {
            const applied = resolveMotive(rules, motive.value)
            const modified = isModified(rules, motive.value)
            return (
              <div
                key={motive.value}
                className={cn(
                  "grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center",
                  modified && "border-primary/50 bg-primary/5"
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {motive.label}
                    {modified ? (
                      <span className="ml-2 text-xs font-normal text-primary">modifié</span>
                    ) : null}
                  </p>
                  {motive.countedInHours ? (
                    <p className="text-xs text-muted-foreground">
                      Se compte en heures — cela ne se règle pas.
                    </p>
                  ) : null}
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground sm:sr-only">Heures</span>
                  <select
                    aria-label={`Traitement des heures — ${motive.label}`}
                    className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm"
                    value={applied.hours}
                    onChange={(event) =>
                      change(
                        withRule(rules, motive.value, {
                          hours: event.target.value as HoursTreatment,
                        })
                      )
                    }
                  >
                    {HOURS_TREATMENTS.map((treatment) => (
                      <option key={treatment} value={treatment}>
                        {HOURS_TREATMENT_LABELS[treatment]}
                      </option>
                    ))}
                  </select>
                </label>

                <ProofControl
                  label={motive.label}
                  expected={applied.proof !== null}
                  dueDays={applied.proof?.dueDays ?? null}
                  onChange={(proof) =>
                    change(withRule(rules, motive.value, { proof }))
                  }
                />
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Le justificatif en trois états : aucun, attendu sans délai, attendu sous N
 * jours. Le champ de jours n'apparaît que dans le troisième — un délai saisi
 * pour un papier qu'on n'attend pas ne serait jamais lu.
 */
function ProofControl({
  label,
  expected,
  dueDays,
  onChange,
}: {
  readonly label: string
  readonly expected: boolean
  readonly dueDays: number | null
  readonly onChange: (proof: { expected: boolean; dueDays: number | null }) => void
}) {
  const mode = !expected ? "none" : dueDays === null ? "open" : "delay"

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground sm:sr-only">Justificatif</span>
      <select
        aria-label={`Justificatif — ${label}`}
        className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm"
        value={mode}
        onChange={(event) => {
          const next = event.target.value
          if (next === "none") onChange({ expected: false, dueDays: null })
          else if (next === "open") onChange({ expected: true, dueDays: null })
          else onChange({ expected: true, dueDays: dueDays ?? 2 })
        }}
      >
        <option value="none">Aucun</option>
        <option value="open">Attendu</option>
        <option value="delay">Attendu sous…</option>
      </select>

      {mode === "delay" ? (
        <span className="flex items-center gap-1.5 text-sm">
          <Input
            type="number"
            min={0}
            max={90}
            className="h-9 w-16"
            aria-label={`Délai du justificatif en jours — ${label}`}
            value={dueDays ?? 2}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              if (!Number.isFinite(parsed) || parsed < 0) return
              onChange({ expected: true, dueDays: Math.round(parsed) })
            }}
          />
          jours
        </span>
      ) : null}
    </div>
  )
}
