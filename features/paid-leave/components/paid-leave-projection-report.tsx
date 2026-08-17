"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { cn } from "@/lib/utils"

import {
  describePaidLeaveTension,
  type PaidLeaveProjection,
} from "@/features/paid-leave/coverage/paid-leave-projection"

/**
 * Où l'arbitrage coince, et ce qui le débloquerait.
 *
 * DEUX NIVEAUX, et c'est tout le sujet de cet écran. La version précédente
 * empilait six blocs de chiffres en corps minuscule, chacun flanqué d'une
 * pastille à survoler : le gérant voyait beaucoup et ne lisait rien. Une aide
 * qu'il faut survoler ne répare pas un texte qui ne se lit pas seul.
 *
 * Donc : un VERDICT en clair, à taille normale, que personne ne peut manquer ;
 * puis le détail dans des sections repliées, dont le titre et le résumé
 * suffisent à savoir s'il faut les ouvrir. Rien n'est caché, tout est hiérarchisé.
 *
 * Aucun corps inférieur à `text-sm` : ces chiffres décident de qui part en
 * vacances, ils ne sont pas une mention légale.
 */
export function PaidLeaveProjectionReport({
  projection,
  weekLabel,
}: {
  readonly projection: PaidLeaveProjection
  readonly weekLabel: (weekId: string) => string
}) {
  const tension = describePaidLeaveTension(projection)
  const { satisfaction } = projection
  const grantedTotal =
    satisfaction.rank1 + satisfaction.rank2 + satisfaction.rank3 + satisfaction.manual
  const firstChoiceShare =
    grantedTotal > 0 ? Math.round((satisfaction.rank1 / grantedTotal) * 100) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Où ça coince</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Le verdict : le seul texte que le gérant lira forcément, donc le seul
            qui doive se suffire — la situation, puis son prix. */}
        <div
          className={cn(
            "rounded-lg border p-4",
            tension.critical
              ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
              : "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
          )}
        >
          <p className="text-base font-medium">{tension.headline}</p>
          {tension.remedy ? <p className="mt-2 text-sm">{tension.remedy}</p> : null}
          {projection.mostContested ? (
            <p className="mt-2 text-sm text-muted-foreground">
              La semaine la plus demandée est {weekLabel(projection.mostContested.weekId)} :{" "}
              {projection.mostContested.requests} personnes la veulent en premier choix.
            </p>
          ) : null}
        </div>

        {projection.criticalWeeks.length > 0 ? (
          <CollapsibleSection
            title={`Les ${projection.criticalWeeks.length} semaines qui coincent`}
            summary={[
              `la plus tendue manque de ${formatHours(projection.criticalWeeks[0].missingHours)}`,
            ]}
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Rayon</th>
                    <th className="py-2 pr-4 font-medium">Semaine</th>
                    <th className="py-2 pr-4 text-right font-medium">Heures manquantes</th>
                    <th className="py-2 pr-4 text-right font-medium">Personnes qui la veulent</th>
                    <th className="py-2 font-medium">Renfort possible</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.criticalWeeks.map((week) => (
                    <tr key={`${week.sectorId}_${week.weekId}`} className="border-b last:border-0">
                      <td className="py-2 pr-4">{week.sectorName}</td>
                      <td className="py-2 pr-4 tabular-nums">{weekLabel(week.weekId)}</td>
                      <td className="py-2 pr-4 text-right font-medium tabular-nums text-red-700 dark:text-red-400">
                        {formatHours(week.missingHours)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{week.wish1Requests}</td>
                      <td className="py-2">
                        {/* La seule case qui change la décision : une semaine
                            qu'aucune enveloppe n'atteint ne se résout pas en
                            achetant des heures, il faut déplacer quelqu'un. */}
                        {week.reachableByPools ? (
                          <span className="text-muted-foreground">oui</span>
                        ) : (
                          <span className="font-medium text-amber-700 dark:text-amber-400">
                            non — déplacer un congé
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection
          title="Ce que l’équipe obtient"
          summary={[
            firstChoiceShare === null
              ? "aucune semaine attribuée"
              : `${firstChoiceShare} % des semaines au premier choix`,
            ...(satisfaction.unservedEmployees > 0
              ? [`${satisfaction.unservedEmployees} sans rien`]
              : []),
          ]}
        >
          <div className="space-y-4 text-sm">
            {grantedTotal > 0 ? (
              <p>
                Sur {grantedTotal} semaine{grantedTotal > 1 ? "s" : ""} attribuée
                {grantedTotal > 1 ? "s" : ""} : <strong>{satisfaction.rank1}</strong> au premier
                choix, <strong>{satisfaction.rank2}</strong> au deuxième,{" "}
                <strong>{satisfaction.rank3}</strong> au troisième
                {satisfaction.manual > 0 ? (
                  <>
                    , et <strong>{satisfaction.manual}</strong> posée
                    {satisfaction.manual > 1 ? "s" : ""} à la main, hors de tout vœu
                  </>
                ) : null}
                .
              </p>
            ) : (
              <p className="text-muted-foreground">Aucune semaine n’a encore été attribuée.</p>
            )}

            {satisfaction.unservedEmployees > 0 ? (
              <p className="font-medium text-red-700 dark:text-red-400">
                {satisfaction.unservedEmployees} personne
                {satisfaction.unservedEmployees > 1 ? "s" : ""} demandai
                {satisfaction.unservedEmployees > 1 ? "en" : ""}t des congés et n’
                {satisfaction.unservedEmployees > 1 ? "en ont" : "a"} obtenu aucun.
              </p>
            ) : null}

            {projection.compromises.length > 0 ? (
              <div className="space-y-1.5">
                <p className="font-medium">Qui a dû décaler des semaines de son premier choix</p>
                <ul className="space-y-1">
                  {projection.compromises.map((entry) => (
                    <li key={entry.employeeId} className="flex flex-wrap justify-between gap-x-4">
                      <span>{entry.name}</span>
                      <span className="text-muted-foreground">
                        {entry.movedWeeks} semaine{entry.movedWeeks > 1 ? "s" : ""} décalée
                        {entry.movedWeeks > 1 ? "s" : ""}
                        {entry.worstRank
                          ? `, jusqu’à son choix ${entry.worstRank}`
                          : ", rien obtenu"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {projection.neverFirstChoice.length > 0 ? (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Ces personnes n’ont jamais obtenu leur premier choix, ni lors des campagnes
                précédentes ni cette fois :{" "}
                <strong>{projection.neverFirstChoice.map((watch) => watch.name).join(", ")}</strong>
                .
              </p>
            ) : null}
          </div>
        </CollapsibleSection>

        {projection.criticalWeeks.length > 0 ? (
          <CollapsibleSection
            title="Abaisser le minimum de couverture"
            summary={[
              projection.reliefThresholdHours !== null
                ? `${projection.reliefThresholdHours} h suffiraient à tout débloquer`
                : "ne suffirait pas à tout débloquer",
            ]}
          >
            <div className="space-y-3 text-sm">
              <p>
                Le minimum de couverture est le nombre d’heures que vous exigez d’avoir présentes
                chaque semaine. C’est le seul levier que vous décidez seul : l’abaisser fait
                disparaître des semaines tendues. Sept heures valent une journée d’une personne,
                trente-cinq une semaine entière.
              </p>
              <ul className="space-y-1">
                {projection.relief.map((step) => (
                  <li key={step.deltaHours} className="flex flex-wrap justify-between gap-x-4">
                    <span className="tabular-nums">Si vous retirez {step.deltaHours} h</span>
                    <span
                      className={cn(
                        step.criticalWeeks === 0
                          ? "font-medium text-emerald-700 dark:text-emerald-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {step.criticalWeeks === 0
                        ? "plus aucune semaine ne coince"
                        : `${step.criticalWeeks} semaine${step.criticalWeeks > 1 ? "s" : ""} coince${step.criticalWeeks > 1 ? "nt" : ""} encore, ${formatHours(step.reinforcementNeededHours)} à trouver`}
                    </span>
                  </li>
                ))}
              </ul>
              {projection.reliefThresholdHours === null ? (
                <p className="text-muted-foreground">
                  Même en retirant 35 h à chaque minimum, la demande ne passe pas : c’est un
                  arbitrage entre personnes, pas une question de seuil.
                </p>
              ) : null}
            </div>
          </CollapsibleSection>
        ) : null}

        {projection.pools.length > 0 ? (
          <CollapsibleSection
            title="Enveloppes de renfort"
            summary={[
              projection.poolsFullyUsed
                ? "entièrement consommées"
                : `${formatHours(projection.pools.reduce((sum, pool) => sum + pool.remainingHours, 0))} encore disponibles`,
            ]}
          >
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Une enveloppe a une période de validité, et parfois un rayon. Si ni l’une ni
                l’autre ne croise une semaine tendue, ces heures ne pourront jamais servir.
              </p>
              <ul className="space-y-2">
                {projection.pools.map((pool) => (
                  <li key={pool.poolId}>
                    <p className="flex flex-wrap justify-between gap-x-4">
                      <span className="font-medium">{pool.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatHours(pool.usedHours)} utilisées sur {formatHours(pool.totalHours)}
                      </span>
                    </p>
                    {!pool.usefulOnCriticalWeeks ? (
                      <p className="text-amber-700 dark:text-amber-400">
                        Cette enveloppe n’atteint aucune semaine tendue : sa période ou son rayon
                        ne le permettent pas.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </CollapsibleSection>
        ) : null}
      </CardContent>
    </Card>
  )
}

function formatHours(value: number): string {
  return `${Math.round(value * 10) / 10} h`
}
