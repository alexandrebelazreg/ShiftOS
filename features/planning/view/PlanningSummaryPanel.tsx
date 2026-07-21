import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type { PlanningFlowResult } from "@/features/planning/flow"

type SuccessResult = Extract<PlanningFlowResult, { status: "success" }>

function percent(value: number | null): string {
  if (value === null) return "—"
  return `${Math.round(value * 100)}%`
}

/**
 * Summary panel — the headline verdict of a generation, every figure sourced
 * from an engine report (no recomputation).
 */
export function PlanningSummaryPanel({ result }: { result: SuccessResult }) {
  const { generation, statistics, durationMs } = result
  const verdict = generation.status

  const warnings = [
    ...generation.score.warnings.map((w) => ({ severity: w.severity, message: w.message })),
    ...generation.fairness.warnings.map((w) => ({ severity: w.severity, message: w.message })),
  ]

  const metrics: { label: string; value: string }[] = [
    { label: "Score global", value: percent(generation.score.overall) },
    { label: "Score d’équité", value: percent(generation.fairness.overall) },
    { label: "Taux de couverture", value: percent(statistics.store.coverageRate) },
    { label: "Temps de génération", value: `${durationMs} ms` },
  ]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Résumé</CardTitle>
          <Badge variant={verdict === "blocked" ? "destructive" : verdict === "degraded" ? "secondary" : "default"}>
            {verdict === "blocked" ? "Bloqué" : verdict === "degraded" ? "Dégradé" : "Complet"}
          </Badge>
        </div>
        <CardDescription>
          {statistics.store.assignmentCount} affectation(s) pour{" "}
          {statistics.store.generatedShifts} service(s)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="space-y-1">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="text-lg font-semibold tabular-nums">{metric.value}</p>
            </div>
          ))}
        </div>

        {warnings.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Alertes ({warnings.length})
            </p>
            <ul className="space-y-1">
              {warnings.map((warning, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  <Badge variant="outline" className="mt-0.5 shrink-0">
                    {warning.severity}
                  </Badge>
                  <span className="text-muted-foreground">{warning.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune alerte.</p>
        )}
      </CardContent>
    </Card>
  )
}
