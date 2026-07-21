/**
 * Why an employee is unavailable on a given day.
 *
 * Every reason maps to a fact already modeled in the core (store schedule,
 * holidays, contract, absences, availability rules, constraints) — no business
 * rule is invented here.
 */
export const UNAVAILABLE_REASONS = [
  "store_closed",
  "public_holiday",
  "absence",
  "date_exception",
  "missing_contract",
  "not_a_working_day",
  "forbidden_day",
  "fixed_day_off",
] as const
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number]
