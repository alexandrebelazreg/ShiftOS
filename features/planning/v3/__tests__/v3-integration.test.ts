import { describe, expect, it } from "vitest"

import { createCpSatAdapter } from "@/features/core/planning-contract/adapters/cp-sat"
import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"

import {
  driveEmployeeRecords,
  historicalSetupPayload,
  readMigratedSectors,
} from "@/features/core/planning-v3/__tests__/drive-problem"
import { preparePlanningGeneration } from "@/features/planning/flow"
import {
  SECTOR_SCOPE,
  sectorStoreConfig,
  smallSector,
  smallSectorEmployees,
  SMALL_SECTOR_SCOPE,
  storeConfig,
} from "@/features/planning/__tests__/planning-fixtures"
import { baselineFromEditorState, describeV3Engine, runV3Generation } from "@/features/planning/v3"
import type { PlanningV3Fetch } from "@/features/planning/v3/solve-client"

/**
 * The whole V3 mode with a REAL solver behind it.
 *
 * SKIPPED unless `RUN_CPSAT=1`: it spawns Python. What it adds over the faked
 * suite is the only thing a fake cannot vouch for — that the problem this
 * application builds is one CP-SAT actually solves, that a lock taken from the
 * screen comes back honoured, and that the acceptance gate passes on a schedule
 * nobody wrote by hand.
 *
 * The HTTP hop is replaced by a direct adapter call, which is exactly what the
 * route handler does with the parsed body. What is under test here is the V3
 * mode; the route's own validation is unit tested separately.
 *
 *   RUN_CPSAT=1 npx vitest run features/planning/v3/__tests__/v3-integration.test.ts
 */

const ENABLED = process.env.RUN_CPSAT === "1"
const LONG = 900_000

/** Stands in for the network: parses the body, runs the real adapter. */
function inProcessRoute(timeoutSeconds = 60): PlanningV3Fetch {
  return async (_path, init) => {
    const body = JSON.parse(init.body)
    const request = buildSolvePlanningRequest(
      body.problem,
      body.regeneration ?? null,
      body.baseline ?? null
    )
    const response = await createCpSatAdapter({ timeoutSeconds })(request)
    return { ok: true, status: 200, text: async () => JSON.stringify(response) }
  }
}

function prepared() {
  const result = preparePlanningGeneration({
    store: storeConfig(),
    employees: smallSectorEmployees(),
    sectors: [smallSector()],
    scope: SMALL_SECTOR_SCOPE,
  })
  if (result.status !== "ready") throw new Error(JSON.stringify(result.errors))
  return result
}

describe.skipIf(!ENABLED)("mode V3 réel — génération", () => {
  it(
    "résout, revalide et accepte un planning produit par CP-SAT",
    async () => {
      const outcome = await runV3Generation({
        prepared: prepared(),
        solve: { fetchImpl: inProcessRoute() },
      })

      expect(outcome.status).toBe("accepted")
      if (outcome.status !== "accepted") return
      expect(outcome.response.metadata.engine).toBe("cp-sat")
      expect(outcome.acceptance.report.validHardConstraints).toBe(true)
      expect(outcome.editorState.assignments.length).toBeGreaterThan(0)
      // The schedule answers the problem this application built, not another.
      expect(outcome.response.solution?.problemFingerprint).toBe(
        outcome.acceptance.solution.problemFingerprint
      )
    },
    LONG
  )
})

describe.skipIf(!ENABLED)("mode V3 réel — la semaine Drive", () => {
  it(
    "traverse tout le chemin applicatif et rend un planning accepté",
    async () => {
      // The real sector, assembled by the application's own flow rather than by
      // the spike's fixture: this is the week a manager would actually generate
      // after switching the control to V3.
      const context = preparePlanningGeneration({
        store: sectorStoreConfig(),
        employees: driveEmployeeRecords(),
        sectors: readMigratedSectors(historicalSetupPayload()),
        scope: SECTOR_SCOPE,
      })
      if (context.status !== "ready") throw new Error(JSON.stringify(context.errors))

      const outcome = await runV3Generation({
        prepared: context,
        solve: { fetchImpl: inProcessRoute(600) },
      })

      expect(outcome.status).toBe("accepted")
      if (outcome.status !== "accepted") return
      expect(outcome.acceptance.report.validHardConstraints).toBe(true)
      expect(outcome.editorState.assignments.length).toBeGreaterThan(0)
      // Drive allows split shifts, which this model does not enumerate, so the
      // space is incomplete and no optimum may be announced however thoroughly
      // the passes were proven. The screen says so, and says it honestly.
      expect(outcome.response.metadata.candidateSpace).toBe("incomplete")
      expect(outcome.response.outcome).toBe("feasible")
      expect(describeV3Engine(outcome.response)).toBe(
        "V3 expérimental — solution faisable, optimalité non prouvée"
      )
    },
    LONG
  )
})

describe.skipIf(!ENABLED)("mode V3 réel — régénération", () => {
  it(
    "reproduit exactement un shift verrouillé pris sur l'écran",
    async () => {
      const context = prepared()
      const first = await runV3Generation({
        prepared: context,
        solve: { fetchImpl: inProcessRoute() },
      })
      if (first.status !== "accepted") throw new Error("première génération refusée")

      const baseline = baselineFromEditorState(first.editorState)
      const pinned = baseline.shifts[0]

      const again = await runV3Generation({
        prepared: context,
        regeneration: {
          preserveLockedShifts: true,
          preserveManualEdits: true,
          minimizeOtherChanges: false,
          lockedShiftIds: [pinned.shiftId],
          editedShifts: [],
        },
        baseline,
        solve: { fetchImpl: inProcessRoute() },
      })

      expect(again.status).toBe("accepted")
      if (again.status !== "accepted") return
      expect(again.response.metadata.respectedLocks).toBe(true)
      expect(again.response.metadata.unmetPreservations).toEqual([])

      const kept = baselineFromEditorState(again.editorState).shifts.find(
        (shift) =>
          String(shift.employeeId) === String(pinned.employeeId) && shift.date === pinned.date
      )
      expect(kept?.segments).toEqual(pinned.segments)
    },
    LONG
  )

  it(
    "impose exactement les minutes d'une retouche manuelle",
    async () => {
      const context = prepared()
      const first = await runV3Generation({
        prepared: context,
        solve: { fetchImpl: inProcessRoute() },
      })
      if (first.status !== "accepted") throw new Error("première génération refusée")

      const baseline = baselineFromEditorState(first.editorState)
      const target = baseline.shifts[0]
      // Same duration, moved one hour inside the SAME day — later when the day
      // has room after it, earlier otherwise. Sliding blindly would push the
      // shift past closing, and the adapter would rightly refuse it as an
      // illegal retouch: a correct answer, but to a different question than the
      // one this test asks.
      const dayOpen = first.problem.days.find((day) => day.date === target.date)?.opensAtMinutes ?? 0
      const dayClose =
        first.problem.days.find((day) => day.date === target.date)?.closesAtMinutes ?? 1_440
      const originalStart = target.segments[0].startMinutes
      const originalEnd = target.segments[target.segments.length - 1].endMinutes
      const shift = originalEnd + 60 <= dayClose ? 60 : originalStart - 60 >= dayOpen ? -60 : 0
      expect(shift).not.toBe(0)
      const start = originalStart + shift
      const end = originalEnd + shift

      const again = await runV3Generation({
        prepared: context,
        regeneration: {
          preserveLockedShifts: true,
          preserveManualEdits: true,
          minimizeOtherChanges: false,
          lockedShiftIds: [],
          editedShifts: [{ shiftId: target.shiftId, startMinute: start, endMinute: end }],
        },
        baseline,
        solve: { fetchImpl: inProcessRoute() },
      })

      // Either the retouch is honoured exactly, or the week is proven not to
      // admit it. Never quietly rounded to something near it.
      if (again.status === "accepted") {
        expect(again.response.metadata.respectedManualEdits).toBe(true)
        const edited = baselineFromEditorState(again.editorState).shifts.find(
          (shift) =>
            String(shift.employeeId) === String(target.employeeId) && shift.date === target.date
        )
        expect(edited?.segments).toEqual([{ startMinutes: start, endMinutes: end }])
      } else {
        expect(again.response?.outcome).toBe("infeasible")
      }
    },
    LONG
  )

  it(
    "refuse une préservation inconnue au lieu de résoudre sans elle",
    async () => {
      const empty: PlanningBaselineV3 = { shifts: [] }
      const outcome = await runV3Generation({
        prepared: prepared(),
        regeneration: {
          preserveLockedShifts: true,
          preserveManualEdits: false,
          minimizeOtherChanges: false,
          lockedShiftIds: ["shift_qui_nexiste_pas"],
          editedShifts: [],
        },
        baseline: empty,
        solve: { fetchImpl: inProcessRoute() },
      })

      expect(outcome.status).toBe("rejected")
      if (outcome.status !== "rejected") return
      expect(outcome.response?.outcome).toBe("invalid-problem")
      expect(outcome.title).toBe("Le moteur V3 a refusé la demande")
      // And nothing was produced to install in place of the current planning.
      expect("editorState" in outcome).toBe(false)
    },
    LONG
  )
})
