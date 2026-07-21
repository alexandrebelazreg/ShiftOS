import type { EmployeeId, Shift, ShiftSegment, Store } from "@/features/core/models"

import type { CoverageRequirement } from "@/features/core/demand-engine"
import type { GenerationSettings } from "@/features/core/planning-generator/types"
import { employeeShiftIdFor, shiftIdFor } from "@/features/core/planning-generator/builders/ids"

/**
 * Build the shift that hosts the assignments for one coverage requirement. The
 * shift's single segment mirrors the requirement's window exactly (start / end /
 * cross-midnight offset). Source is `dynamic` — the generator creates it, it is
 * not drawn from the shift library.
 *
 * One requirement → one shift keeps the mapping trivial and reversible; it does
 * not merge or split windows (that would be optimization, out of scope for V1).
 */
export function buildShiftForRequirement(
  requirement: CoverageRequirement,
  store: Store,
  settings: GenerationSettings
): Shift {
  const { window } = requirement
  const segment: ShiftSegment =
    window.endDayOffset != null
      ? { startTime: window.start, endTime: window.end, endDayOffset: window.endDayOffset }
      : { startTime: window.start, endTime: window.end }

  return {
    id: shiftIdFor(requirement.id),
    storeId: store.id,
    templateId: null,
    date: window.date,
    source: "dynamic",
    segments: [segment],
    createdAt: settings.now,
    updatedAt: settings.now,
  }
}


/** Clone a demand template into one independently mutable employee shift. */
export function buildEmployeeShiftForRequirement(
  template: Shift,
  requirement: CoverageRequirement,
  employeeId: EmployeeId
): Shift {
  return {
    ...template,
    id: employeeShiftIdFor(requirement.id, employeeId, requirement.window.date),
    segments: template.segments.map((segment) => ({ ...segment })),
  }
}
