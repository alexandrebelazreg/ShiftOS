import { describe, expect, it } from "vitest"

import { decidePublication } from "@/features/planning/board/model/publish-decision"

/**
 * The gate exists because publishing is irreversible for the team that reads
 * the schedule. These tests are the specification: a legal schedule publishes
 * on one click, a degraded one asks, and an illegal one cannot be talked into
 * publishing — not by a checkbox, not by an engine that only knows how to say
 * "reserves".
 */
describe("décision de publication — planning conforme", () => {
  it("publie directement quand rien n'est signalé", () => {
    expect(
      decidePublication({
        validHardConstraints: true,
        hasBlockingViolation: false,
        requiresExplicitAcceptance: false,
        underCoveredSlots: 0,
        avoidableSurplusMinutes: 0,
      })
    ).toBe("publish-directly")
  })

  it("publie directement quand le rapport ne dit rien du tout", () => {
    // An absent field means "not stated", never "false" — an empty report must
    // not invent a blocker any more than it invents a reserve.
    expect(decidePublication({})).toBe("publish-directly")
  })
})

describe("décision de publication — réserves acceptables", () => {
  it("demande une acceptation pour une couverture dégradée seule", () => {
    expect(
      decidePublication({
        validHardConstraints: true,
        underCoveredSlots: 3,
      })
    ).toBe("require-explicit-acceptance")
  })

  it("demande une acceptation pour un surplus évitable seul", () => {
    expect(
      decidePublication({
        validHardConstraints: true,
        underCoveredSlots: 0,
        avoidableSurplusMinutes: 240,
      })
    ).toBe("require-explicit-acceptance")
  })

  it("demande une acceptation quand le moteur la réclame sans chiffre", () => {
    expect(decidePublication({ requiresExplicitAcceptance: true })).toBe(
      "require-explicit-acceptance"
    )
  })

  it("publie une fois les réserves acceptées", () => {
    expect(
      decidePublication({
        validHardConstraints: true,
        underCoveredSlots: 3,
        acceptedDegradations: true,
      })
    ).toBe("publish-directly")
  })
})

describe("décision de publication — violation dure", () => {
  it("bloque sur une violation bloquante seule", () => {
    expect(decidePublication({ hasBlockingViolation: true })).toBe("block-publication")
    expect(decidePublication({ blockingViolations: 1 })).toBe("block-publication")
  })

  it("bloque même quand les dégradations ont été acceptées", () => {
    // The whole point of the checkbox is to own a coverage shortfall. It has no
    // authority over a hard constraint, so ticking it changes nothing here.
    expect(
      decidePublication({
        hasBlockingViolation: true,
        underCoveredSlots: 2,
        requiresExplicitAcceptance: true,
        acceptedDegradations: true,
      })
    ).toBe("block-publication")
  })

  it("bloque sur validHardConstraints === false, sans violation listée", () => {
    expect(
      decidePublication({
        validHardConstraints: false,
        hasBlockingViolation: false,
        blockingViolations: 0,
        acceptedDegradations: true,
      })
    ).toBe("block-publication")
  })
})
