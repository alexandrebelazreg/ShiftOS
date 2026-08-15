"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

import type { PaidLeaveProjection } from "@/features/paid-leave/coverage/paid-leave-projection"

/**
 * Ce que l'arbitrage coûte, mis à plat.
 *
 * La couverture dit « ça passe » ou « ça ne passe pas ». Ce tableau répond aux
 * questions qu'on se pose en NÉGOCIANT : quelles semaines sont intenables si
 * chacun a son premier vœu, combien d'heures il faudrait pour les tenir, et si
 * le budget déjà voté a seulement servi. Un gérant qui doit refuser une semaine
 * à quelqu'un a besoin de pouvoir dire POURQUOI, avec un nombre.
 */
export function PaidLeaveProjectionReport({
  projection,
  weekLabel,
}: {
  readonly projection: PaidLeaveProjection
  readonly weekLabel: (weekId: string) => string
}) {
  const { satisfaction } = projection
  const grantedTotal = satisfaction.rank1 + satisfaction.rank2 + satisfaction.rank3 + satisfaction.manual

  return (
    <Card>
      <CardHeader>
        <CardTitle>Projection et marge de manœuvre</CardTitle>
        <CardDescription>
          Tout est mesuré contre le scénario « chacun obtient son premier vœu » — la demande
          brute de l’équipe, avant tout arbitrage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Renfort nécessaire"
            value={hours(projection.reinforcementNeededHours)}
            hint="pour que chacun ait son vœu 1"
          />
          <Stat
            label="Mobilisable"
            value={hours(projection.reinforcementReachableHours)}
            hint="enveloppes atteignant ces semaines"
          />
          <Stat
            label="Manque"
            value={hours(projection.reinforcementMissingHours)}
            hint={projection.reinforcementMissingHours > 0 ? "budget insuffisant" : "le budget suffit"}
            tone={projection.reinforcementMissingHours > 0 ? "warn" : "ok"}
          />
        </div>

        {projection.criticalWeeks.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              Semaines critiques si chacun a son vœu 1
              {projection.mostContested ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  la plus disputée : {weekLabel(projection.mostContested.weekId)} ·{" "}
                  {projection.mostContested.requests} demandes
                </span>
              ) : null}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Rayon</th>
                    <th className="py-1.5 pr-3 font-medium">Semaine</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Manque</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Demandes V1</th>
                    <th className="py-1.5 font-medium">Renfort</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.criticalWeeks.map((week) => (
                    <tr key={`${week.sectorId}_${week.weekId}`} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{week.sectorName}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{weekLabel(week.weekId)}</td>
                      <td className="py-1.5 pr-3 text-right font-medium tabular-nums text-red-700 dark:text-red-400">
                        −{hours(week.missingHours)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{week.wish1Requests}</td>
                      <td className="py-1.5 text-xs">
                        {/* Une semaine tendue qu'aucune enveloppe ne peut
                            atteindre ne se résout pas en achetant des heures :
                            elle se résout en déplaçant quelqu'un. */}
                        {week.reachableByPools ? (
                          <span className="text-muted-foreground">atteignable</span>
                        ) : (
                          <span className="font-medium text-amber-700 dark:text-amber-400">
                            hors de portée des enveloppes
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            Aucune semaine ne casse si chacun obtient son premier vœu : il n’y a rien à arbitrer.
          </p>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Ce que la proposition actuelle donne</h3>
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill label="Vœu 1" value={satisfaction.rank1} tone="ok" />
            <Pill label="Vœu 2" value={satisfaction.rank2} />
            <Pill label="Vœu 3" value={satisfaction.rank3} />
            {satisfaction.manual > 0 ? <Pill label="Hors vœux" value={satisfaction.manual} tone="warn" /> : null}
            {satisfaction.unservedEmployees > 0 ? (
              <Pill label="Personnes sans rien" value={satisfaction.unservedEmployees} tone="bad" />
            ) : null}
          </div>
          {grantedTotal > 0 ? (
            <p className="text-xs text-muted-foreground">
              {satisfaction.rank1} semaine{satisfaction.rank1 > 1 ? "s" : ""} sur {grantedTotal} au
              premier vœu, soit {Math.round((satisfaction.rank1 / grantedTotal) * 100)} %.
            </p>
          ) : null}
        </section>

        {projection.relief.length > 0 && projection.criticalWeeks.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Et si le minimum descendait ?</h3>
            {/* Le seul levier que le gérant tient vraiment en main : il négocie
                un vœu, mais il DÉCIDE d'un minimum. Jusqu'ici cette décision
                était aveugle — rien ne disait ce qu'elle rachèterait. */}
            <p className="text-xs text-muted-foreground">
              Sept heures valent une journée d’une personne, trente-cinq une semaine entière.
            </p>
            <div className="flex flex-wrap gap-2">
              {projection.relief.map((step) => (
                <div
                  key={step.deltaHours}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    step.criticalWeeks === 0 &&
                      "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                  )}
                >
                  <p className="font-semibold tabular-nums">−{step.deltaHours} h</p>
                  <p className="text-muted-foreground">
                    {step.criticalWeeks === 0
                      ? "plus aucune semaine critique"
                      : `${step.criticalWeeks} semaine${step.criticalWeeks > 1 ? "s" : ""} · ${hours(step.reinforcementNeededHours)} à trouver`}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-sm">
              {projection.reliefThresholdHours !== null ? (
                <>
                  Abaisser chaque minimum de{" "}
                  <strong>{projection.reliefThresholdHours} h</strong> suffirait à servir tout le
                  monde en vœu 1, sans un seul renfort.
                </>
              ) : (
                <span className="text-muted-foreground">
                  Même en retirant 35 h à chaque minimum, la demande brute ne passe pas : c’est un
                  arbitrage entre personnes, pas une question de seuil.
                </span>
              )}
            </p>
          </section>
        ) : null}

        {projection.compromises.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Qui a reculé, et de combien</h3>
            {/* Le compromis se lit par DIFFÉRENCE entre le premier vœu et ce
                qui est obtenu, jamais par le rang seul : quelqu'un servi « en
                vœu 2 » sur une semaine qu'il réclamait aussi en vœu 1 n'a rien
                perdu, et le rang le dirait pourtant. */}
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {projection.compromises.map((entry) => (
                <li key={entry.employeeId} className="flex items-baseline justify-between gap-3 rounded-lg border px-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate">{entry.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {entry.movedWeeks} semaine{entry.movedWeeks > 1 ? "s" : ""} déplacée
                    {entry.movedWeeks > 1 ? "s" : ""}
                    {entry.worstRank ? ` · jusqu’au vœu ${entry.worstRank}` : " · rien obtenu"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {projection.neverFirstChoice.length > 0 || projection.repeatedFirstChoice.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Équité entre campagnes</h3>
            {/* L'historique nourrissait déjà le solveur sans que personne ne
                puisse le VOIR. C'est pourtant le seul arbitrage qu'on reproche
                vraiment à un gérant : celui qui se répète d'une année sur l'autre. */}
            {projection.neverFirstChoice.length > 0 ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <strong>Jamais servi au vœu 1, et pas davantage cette fois :</strong>{" "}
                {projection.neverFirstChoice.map((watch) => watch.name).join(", ")}.
              </p>
            ) : null}
            {projection.repeatedFirstChoice.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Obtiennent à nouveau leur vœu 1 :{" "}
                {projection.repeatedFirstChoice
                  .map((watch) => `${watch.name} (${watch.previousFirstChoices}×)`)
                  .join(", ")}
                .
              </p>
            ) : null}
          </section>
        ) : null}

        {projection.pools.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              Enveloppes de renfort
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {projection.poolsFullyUsed
                  ? "entièrement consommées par la proposition"
                  : "il reste des heures non utilisées"}
              </span>
            </h3>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {projection.pools.map((pool) => (
                <div key={pool.poolId} className="rounded-lg border p-3 text-xs">
                  <p className="font-medium">{pool.label}</p>
                  <p className="text-muted-foreground">
                    {hours(pool.usedHours)} utilisées · {hours(pool.remainingHours)} restantes sur{" "}
                    {hours(pool.totalHours)}
                  </p>
                  {!pool.usefulOnCriticalWeeks ? (
                    <p className="mt-1 font-medium text-amber-700 dark:text-amber-400">
                      N’atteint aucune semaine critique — sa fenêtre ou son rayon ne le permettent pas.
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  readonly label: string
  readonly value: string
  readonly hint: string
  readonly tone?: "neutral" | "ok" | "warn"
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
          tone === "ok" && "text-emerald-700 dark:text-emerald-400"
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

function Pill({
  label,
  value,
  tone = "neutral",
}: {
  readonly label: string
  readonly value: number
  readonly tone?: "neutral" | "ok" | "warn" | "bad"
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1",
        tone === "ok" && "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
        tone === "bad" && "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
      )}
    >
      {label} · <span className="font-semibold tabular-nums">{value}</span>
    </span>
  )
}

function hours(value: number): string {
  return `${Math.round(value * 10) / 10} h`
}
