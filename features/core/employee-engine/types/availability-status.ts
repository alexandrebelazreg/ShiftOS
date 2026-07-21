/**
 * Whether an employee can be scheduled on a given day.
 * - `available`   — schedulable for the whole opening window.
 * - `unavailable` — not schedulable at all.
 * - `limited`     — schedulable only within specific windows.
 */
export const AVAILABILITY_STATUSES = [
  "available",
  "unavailable",
  "limited",
] as const
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number]
