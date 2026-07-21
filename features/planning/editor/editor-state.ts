import type { Assignment, Planning, Shift } from "@/features/core/models"

import type { PlanningInput } from "@/features/core/data-bridge"
import type { GenerationSettings } from "@/features/core/planning-generator"
import type { StoreConfiguration } from "@/features/store/models"
import { storeConfigurationService } from "@/features/store/services/store-configuration-service"

/**
 * EditorState — the ONE planning the editor works on. The immutable context
 * (`coreInput`, `configuration`, `planning`, `settings`) never changes; only
 * `shifts` and `assignments` are edited. Every view and every indicator is
 * derived from this single state, so an edit is reflected everywhere at once.
 */
export interface EditorState {
  readonly coreInput: PlanningInput
  readonly configuration: StoreConfiguration
  readonly planning: Planning
  readonly settings: GenerationSettings
  readonly shifts: readonly Shift[]
  readonly assignments: readonly Assignment[]
}

/** What the editor is initialized from (the output of a generation run). */
export interface EditorInit {
  readonly coreInput: PlanningInput
  readonly configuration: StoreConfiguration
  readonly planning: Planning
  readonly shifts: readonly Shift[]
  readonly assignments: readonly Assignment[]
}

/**
 * Rebuild the `GenerationSettings` (policies + scope) from the configuration and
 * the planning, so the editor re-evaluates with the exact same policies the
 * generator used — no engine or Data Bridge change, only public store APIs.
 */
function reconstructSettings(
  configuration: StoreConfiguration,
  planning: Planning
): GenerationSettings {
  return storeConfigurationService.toGenerationSettings(configuration, {
    planningId: planning.id,
    period: { start: planning.periodStart, end: planning.periodEnd },
    now: planning.updatedAt,
  })
}

/** Create the editor state from a generated planning. */
export function createEditorState(init: EditorInit): EditorState {
  return {
    coreInput: init.coreInput,
    configuration: init.configuration,
    planning: init.planning,
    settings: reconstructSettings(init.configuration, init.planning),
    shifts: init.shifts,
    assignments: init.assignments,
  }
}

/** Replace the mutable planning of a state, keeping the immutable context. */
export function withPlanning(
  state: EditorState,
  shifts: readonly Shift[],
  assignments: readonly Assignment[]
): EditorState {
  return { ...state, shifts, assignments }
}
