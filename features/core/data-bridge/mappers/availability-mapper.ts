import type {
  AvailabilityEffect,
  AvailabilityRule,
  AvailabilityRuleKind,
  IsoDateTime,
  TimeWindow,
  WeekDay,
} from "@/features/core/models"

import type { AvailabilityRuleInput } from "@/features/core/data-bridge/types"
import { toAvailabilityRuleId, toEmployeeId } from "@/features/core/data-bridge/adapters"

/**
 * Translate a future Leave / Availability module DTO into the core
 * `AvailabilityRule`. Pure shape translation: the flat DTO's `effect` / `kind`
 * strings and optional weekday / date / range / window are passed straight
 * through onto the core shape.
 */
export function mapAvailabilityRule(
  input: AvailabilityRuleInput,
  now: IsoDateTime
): AvailabilityRule {
  const window: TimeWindow | null = input.window
    ? {
        start: input.window.start,
        end: input.window.end,
        endDayOffset: input.window.endDayOffset,
      }
    : null

  return {
    id: toAvailabilityRuleId(input.id),
    employeeId: toEmployeeId(input.employeeId),
    effect: input.effect as AvailabilityEffect,
    kind: input.kind as AvailabilityRuleKind,
    weekDay: (input.weekDay as WeekDay | null | undefined) ?? null,
    date: input.date ?? null,
    range: input.range ?? null,
    window,
    createdAt: now,
    updatedAt: now,
  }
}
