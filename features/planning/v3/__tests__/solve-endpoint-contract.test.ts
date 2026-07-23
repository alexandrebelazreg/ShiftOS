import { describe, expect, it } from "vitest"

import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"

import {
  parsePlanningV3Request,
  PLANNING_V3_ENDPOINT_VERSION,
  PLANNING_V3_MAX_PAYLOAD_BYTES,
  PLANNING_V3_MAX_TIMEOUT_SECONDS,
} from "@/features/planning/v3"

/**
 * The route handler's front door, tested without a route handler.
 *
 * A route handler is a public HTTP surface the moment it exists, and behind
 * this one is a native solver in a subprocess. Everything arriving is untrusted,
 * so every refusal below happens BEFORE anything is spawned — and none of them
 * is an infeasibility, because a malformed request says nothing about the week.
 */

const problem = tinyProblem()

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    endpointVersion: PLANNING_V3_ENDPOINT_VERSION,
    problem,
    timeoutSeconds: 30,
    ...overrides,
  })
}

describe("validation de la requête V3", () => {
  it("accepte une requête bien formée", () => {
    expect(parsePlanningV3Request(body()).ok).toBe(true)
  })

  it("accepte une régénération et un planning de référence", () => {
    const parsed = parsePlanningV3Request(
      body({
        regeneration: {
          preserveLockedShifts: true,
          preserveManualEdits: true,
          minimizeOtherChanges: false,
          lockedShiftIds: ["s1"],
          editedShifts: [],
        },
        baseline: { shifts: [] },
      })
    )
    expect(parsed.ok).toBe(true)
  })

  it("refuse une charge déraisonnable avant de la parser", () => {
    // The limit protects memory, so it must bite before `JSON.parse` turns
    // megabytes of text into objects.
    const huge = `{"padding":"${"x".repeat(PLANNING_V3_MAX_PAYLOAD_BYTES + 10)}"}`
    expect(parsePlanningV3Request(huge)).toMatchObject({ ok: false, code: "payload-too-large" })
  })

  it("refuse un corps illisible", () => {
    expect(parsePlanningV3Request("<html>500</html>")).toMatchObject({
      ok: false,
      code: "body-not-json",
    })
  })

  it("refuse un corps qui n'est pas un objet", () => {
    expect(parsePlanningV3Request("[1,2]")).toMatchObject({ ok: false, code: "body-not-an-object" })
  })

  it("refuse une version de frontière différente", () => {
    expect(parsePlanningV3Request(body({ endpointVersion: "planning-v3-solve/0" }))).toMatchObject({
      ok: false,
      code: "endpoint-version-mismatch",
    })
  })

  it("refuse une requête sans problème", () => {
    const raw = JSON.stringify({ endpointVersion: PLANNING_V3_ENDPOINT_VERSION })
    expect(parsePlanningV3Request(raw)).toMatchObject({ ok: false, code: "problem-missing" })
  })

  it("refuse une version de problème différente", () => {
    expect(
      parsePlanningV3Request(body({ problem: { ...problem, version: "v2.0.0" } }))
    ).toMatchObject({ ok: false, code: "problem-version-mismatch" })
  })

  it.each(["employees", "days", "employeeDays", "demandSlots", "objectives"])(
    "refuse un problème dont « %s » n'est pas un tableau",
    (field) => {
      expect(
        parsePlanningV3Request(body({ problem: { ...problem, [field]: "beaucoup" } }))
      ).toMatchObject({ ok: false, code: "problem-malformed" })
    }
  )

  it("refuse un problème sans règles ni période", () => {
    expect(parsePlanningV3Request(body({ problem: { ...problem, rules: null } }))).toMatchObject({
      ok: false,
      code: "problem-malformed",
    })
  })

  it("refuse une régénération incomplète", () => {
    expect(
      parsePlanningV3Request(body({ regeneration: { lockedShiftIds: [], editedShifts: [] } }))
    ).toMatchObject({ ok: false, code: "regeneration-malformed" })
  })

  it("refuse un planning de référence mal formé", () => {
    expect(parsePlanningV3Request(body({ baseline: { shifts: "aucun" } }))).toMatchObject({
      ok: false,
      code: "baseline-malformed",
    })
  })

  it.each([0, -1, PLANNING_V3_MAX_TIMEOUT_SECONDS + 1, Number.NaN, "trente"])(
    "refuse un délai hors bornes (%s)",
    (timeoutSeconds) => {
      expect(parsePlanningV3Request(body({ timeoutSeconds }))).toMatchObject({
        ok: false,
        code: "timeout-out-of-range",
      })
    }
  )

  it("accepte l'absence de délai, la frontière ayant le sien", () => {
    const raw = JSON.stringify({ endpointVersion: PLANNING_V3_ENDPOINT_VERSION, problem })
    expect(parsePlanningV3Request(raw).ok).toBe(true)
  })

  it("ne rend jamais une infaisabilité", () => {
    // Every refusal is about the REQUEST. None of them is a claim about whether
    // the week can be staffed, and the vocabulary makes that unrepresentable.
    const refusals = [
      parsePlanningV3Request("pas du json"),
      parsePlanningV3Request(body({ endpointVersion: "x" })),
      parsePlanningV3Request(body({ timeoutSeconds: -5 })),
    ]
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false)
      if (refusal.ok) continue
      expect(refusal.code).not.toContain("infeasible")
    }
  })
})
