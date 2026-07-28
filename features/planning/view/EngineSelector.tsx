"use client"

import { Button } from "@/components/ui/button"
import {
  PLANNING_ENGINE_LABELS,
  PLANNING_ENGINE_VERSIONS,
  type PlanningEngineVersion,
} from "@/features/core/planning-v3/types/engine-version"

/**
 * The engine switch — deliberately small, and deliberately always visible.
 *
 * Small because it is not a feature: it is a developer-facing escape hatch that
 * happens to live in the product while V3 is experimental. Always visible
 * because a hidden toggle is how someone ends up on an experimental engine
 * without knowing it — the screen must be able to answer "which engine made
 * this?" at a glance, and a control you can see is the cheapest way to do that.
 *
 * It only chooses what the NEXT generation will use. Switching it never touches
 * the planning currently on screen: that would be a silent regeneration, and a
 * silent regeneration is the one thing this whole sprint exists to prevent.
 */
export function EngineSelector({
  value,
  onChange,
  disabled,
}: {
  readonly value: PlanningEngineVersion
  readonly onChange: (version: PlanningEngineVersion) => void
  readonly disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Moteur de planification">
      <span className="text-xs text-muted-foreground">Moteur :</span>
      {/* Driven by the declared list, not a literal: an engine added to the
          model must appear here without anyone remembering to edit this file. */}
      {PLANNING_ENGINE_VERSIONS.map((version) => (
        <Button
          key={version}
          type="button"
          size="sm"
          variant={value === version ? "default" : "outline"}
          aria-pressed={value === version}
          disabled={disabled}
          onClick={() => onChange(version)}
          className="h-7 px-2 text-xs"
        >
          {PLANNING_ENGINE_LABELS[version]}
        </Button>
      ))}
    </div>
  )
}
