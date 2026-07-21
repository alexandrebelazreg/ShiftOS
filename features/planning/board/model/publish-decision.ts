/**
 * The publication gate, decided outside React.
 *
 * Publishing is the one irreversible action of the planning screen, so the rule
 * that governs it must not live inside a click handler where it can only be
 * exercised through a browser. This module states it once, as a pure function
 * over a poor input shape, and every caller — the V2 board summary today, a V3
 * validation report tomorrow — reduces to that shape.
 *
 * The important part is what it refuses to do: it never decides from a display
 * status alone. `status === "reserves"` conflates "someone must accept a
 * shortfall" with "a hard rule is broken" whenever the engine can only report a
 * single severity, and a schedule that breaks a hard rule must never become
 * publishable because a checkbox was ticked.
 */

export type PublishDecision =
  | "publish-directly"
  | "require-explicit-acceptance"
  | "block-publication"

/**
 * Everything the gate needs, and nothing else. Every field is optional because
 * neither engine reports all of them: an absent field is "not stated", never
 * "false". Only an explicit `false` on `validHardConstraints` blocks.
 */
export interface PublishDecisionInput {
  /**
   * The validator's verdict on hard constraints. `false` blocks on its own,
   * even when no violation is listed — the report saying the schedule is
   * invalid outranks an empty violation list.
   */
  readonly validHardConstraints?: boolean
  /** True when the run reported at least one blocking violation. */
  readonly hasBlockingViolation?: boolean
  /** Count of blocking violations, when the caller has it rather than a flag. */
  readonly blockingViolations?: number
  /** Reserves the engine itself flags as needing a human acceptance. */
  readonly requiresExplicitAcceptance?: boolean
  /** Demand slots left short: a coverage degradation, never a blocker. */
  readonly underCoveredSlots?: number
  /**
   * Surplus a better schedule could have removed. It is a real reserve — the
   * store pays for it — but it is legal, so it asks rather than blocks.
   */
  readonly avoidableSurplusMinutes?: number
  /**
   * Whether the user has already accepted the reserves. It can only turn
   * `require-explicit-acceptance` into `publish-directly`; it is read after the
   * blocking check and can therefore never unblock anything.
   */
  readonly acceptedDegradations?: boolean
}

/** True when a hard rule is broken, whichever way the caller can express it. */
function isBlocked(input: PublishDecisionInput): boolean {
  if (input.validHardConstraints === false) return true
  if (input.hasBlockingViolation === true) return true
  return (input.blockingViolations ?? 0) > 0
}

/** True when something legal still needs a human to own it. */
function needsAcceptance(input: PublishDecisionInput): boolean {
  if (input.requiresExplicitAcceptance === true) return true
  if ((input.underCoveredSlots ?? 0) > 0) return true
  return (input.avoidableSurplusMinutes ?? 0) > 0
}

/**
 * Decide what a click on "Publier" is allowed to do.
 *
 * The order is the rule: blocking is evaluated first and returns immediately,
 * so no acceptance — given, remembered or replayed — can reach a schedule that
 * violates a hard constraint.
 */
export function decidePublication(input: PublishDecisionInput): PublishDecision {
  if (isBlocked(input)) return "block-publication"
  if (needsAcceptance(input) && input.acceptedDegradations !== true) {
    return "require-explicit-acceptance"
  }
  return "publish-directly"
}
