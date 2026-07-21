import { Card, CardContent } from "@/components/ui/card"

import type { EditorEvaluation } from "@/features/planning/editor"
import { LevelBadge } from "@/features/planning/editor/ui/level-badge"

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * The always-visible live indicators bar. Every value comes from the current
 * evaluation, so it updates on every edit with no manual refresh.
 */
export function LiveIndicatorsBar({ evaluation }: { evaluation: EditorEvaluation }) {
  const { indicators, level, canPublish } = evaluation
  const metrics: { label: string; value: string }[] = [
    { label: "Qualité du planning", value: pct(indicators.quality) },
    { label: "Couverture", value: pct(indicators.coverage) },
    { label: "Équité", value: pct(indicators.fairness) },
    { label: "Respect des contrats", value: pct(indicators.contractCompliance) },
    { label: "Contraintes", value: indicators.constraintStatus },
  ]

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 py-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="space-y-0.5">
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <p className="text-lg font-semibold capitalize tabular-nums">{metric.value}</p>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <LevelBadge level={level} className="uppercase">
            {level}
          </LevelBadge>
          {!canPublish ? (
            <span className="text-xs text-muted-foreground">Bloquant — publication impossible</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
