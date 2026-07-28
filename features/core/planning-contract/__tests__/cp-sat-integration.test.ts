import { describe, expect, it } from "vitest"

import { buildDriveProblem } from "@/features/core/planning-v3/__tests__/drive-problem"
import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"
import type { EmployeeId } from "@/features/core/models"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"

import { coverageDeficitMinutes, minimumConcurrentPresence } from "@/features/core/shared"

import { createCpSatAdapter } from "@/features/core/planning-contract/adapters/cp-sat"
import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import { checkSolvePlanningResponse } from "@/features/core/planning-contract/invariants"
import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"
import type { PlanningRegenerationRequest } from "@/features/core/planning-contract/types/regeneration"

/**
 * CP-SAT for real: a spawned Python process, OR-Tools, the whole boundary.
 *
 * SKIPPED unless `RUN_CPSAT=1`. Solving the Drive week takes minutes, and a
 * suite that quietly costs minutes is a suite people stop running. Everything
 * that can be checked without a solver already is, in `cp-sat-unit.test.ts`;
 * what remains here is the part no fake can vouch for — that the model really
 * honours a lock, that the numbers the spike published still hold, and that a
 * preservation the week cannot absorb produces an honest answer rather than a
 * quietly relaxed one.
 *
 *   npx vitest run features/core/planning-contract/__tests__/cp-sat-integration.test.ts
 *   (with RUN_CPSAT=1 in the environment)
 */

const ENABLED = process.env.RUN_CPSAT === "1"
const LONG = 900_000

const employee = (id: string): EmployeeId => id as unknown as EmployeeId

function regeneration(
  overrides: Partial<PlanningRegenerationRequest> = {}
): PlanningRegenerationRequest {
  return {
    preserveLockedShifts: true,
    preserveManualEdits: true,
    minimizeOtherChanges: false,
    lockedShiftIds: [],
    editedShifts: [],
    ...overrides,
  }
}

/**
 * The three business figures, recomputed from the schedule itself.
 *
 * FIXED 2026-07-24 alongside the coverage-concurrency bug: this used to ask
 * "does one segment span the whole slot," the same full-span containment
 * check that under-counted concurrent presence everywhere else. Now shares
 * the same atomic-interval reasoning as the engine it is checking, via
 * `features/core/shared/coverage.ts` — a test helper computing coverage its
 * own buggy way would have kept passing after the engine was fixed, silently
 * asserting numbers the production code no longer produces.
 */
function businessFigures(problem: PlanningProblemV3, solution: PlanningSolutionV3) {
  const budgetByDate = new Map(problem.days.map((day) => [day.date, day.budgetMinutes]))
  let underCoveredSlots = 0
  let deficitMinutes = 0
  let businessDeficitCost = 0

  for (const slot of problem.demandSlots) {
    const window = { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes }
    const intervals = solution.assignments
      .filter((assignment) => assignment.date === slot.date)
      .flatMap((assignment) => assignment.segments)
    const covered = minimumConcurrentPresence(window, intervals)
    if (covered >= slot.requiredEmployees) continue
    const minutes = coverageDeficitMinutes(window, intervals, slot.requiredEmployees)
    underCoveredSlots += 1
    deficitMinutes += minutes
    businessDeficitCost += minutes * (budgetByDate.get(slot.date) ?? 0)
  }
  return { underCoveredSlots, deficitMinutes, businessDeficitCost }
}

/** The solved week, re-expressed as the board would hand it back. */
function baselineOf(solution: PlanningSolutionV3): PlanningBaselineV3 {
  return {
    shifts: solution.assignments.map((assignment, index) => ({
      shiftId: `b${index}`,
      employeeId: assignment.employeeId,
      date: assignment.date,
      segments: assignment.segments,
    })),
  }
}

describe.skipIf(!ENABLED)("CP-SAT réel — résolution simple", () => {
  it(
    "résout un problème sans régénération et rend une réponse conforme",
    async () => {
      const problem = tinyProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 30 })
      const response = await adapter(buildSolvePlanningRequest(problem))

      expect(response.metadata.engine).toBe("cp-sat")
      expect(["optimal", "feasible"]).toContain(response.outcome)
      expect(response.solution).not.toBeNull()
      expect(response.diagnostics.blocking).toBe(false)
      expect(checkSolvePlanningResponse(response)).toEqual([])
      // The tiny problem forbids split shifts, so the space is complete and the
      // optimum is genuinely claimable.
      expect(response.metadata.candidateSpace).toBe("complete")
      expect(response.outcome).toBe("optimal")
    },
    LONG
  )
})

describe.skipIf(!ENABLED)("CP-SAT réel — préservations", () => {
  it(
    "reproduit exactement un shift verrouillé",
    async () => {
      const problem = tinyProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 30 })

      const free = await adapter(buildSolvePlanningRequest(problem))
      const baseline = baselineOf(free.solution!)
      const pinned = baseline.shifts[0]

      const response = await adapter(
        buildSolvePlanningRequest(
          problem,
          regeneration({ lockedShiftIds: [pinned.shiftId] }),
          baseline
        )
      )

      expect(response.metadata.respectedLocks).toBe(true)
      expect(response.metadata.unmetPreservations).toEqual([])
      const kept = response.solution!.assignments.find(
        (assignment) =>
          String(assignment.employeeId) === String(pinned.employeeId) &&
          assignment.date === pinned.date
      )
      expect(kept?.segments).toEqual(pinned.segments)
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "impose exactement les minutes d'une retouche manuelle",
    async () => {
      // Slack on purpose. With an exact daily budget AND an opening and a
      // closing to place, a two-employee day has exactly one shape and NO edit
      // is absorbable — the honest answer would be `infeasible`, which is a
      // different test. Here the day is long enough and the coverage rules
      // quiet enough that shortening one shift can be paid back elsewhere.
      const problem = tinyProblem({
        employees: [
          { id: "e1", contractMinutes: 480, canOpen: true, canClose: true },
          { id: "e2", contractMinutes: 480, canOpen: true, canClose: true },
        ],
        openMinutes: 480,
        closeMinutes: 1_200,
        budgetMinutes: 480,
        slotRequirement: 0,
        rules: {
          minimumShiftMinutes: 60,
          maximumShiftMinutes: 720,
          minimumOpeningsPerDay: 0,
          exactClosingsPerDay: 0,
        },
      })
      const adapter = createCpSatAdapter({ timeoutSeconds: 30 })
      const free = await adapter(buildSolvePlanningRequest(problem))
      const baseline = baselineOf(free.solution!)
      const target = baseline.shifts.find((shift) => String(shift.employeeId) === "e1")!

      const response = await adapter(
        buildSolvePlanningRequest(
          problem,
          regeneration({
            editedShifts: [{ shiftId: target.shiftId, startMinute: 540, endMinute: 660 }],
          }),
          baseline
        )
      )

      expect(response.outcome).not.toBe("invalid-problem")
      expect(response.metadata.respectedManualEdits).toBe(true)
      const edited = response.solution!.assignments.find(
        (assignment) =>
          String(assignment.employeeId) === "e1" && assignment.date === target.date
      )
      expect(edited?.segments).toEqual([{ startMinutes: 540, endMinutes: 660 }])
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "reste honnête face à une préservation que la semaine ne peut pas absorber",
    async () => {
      // e1 must work both days and is contracted for 240 minutes in total. An
      // edit that spends all 240 on the first day leaves nothing for the
      // second, which is mandatory. Nothing is relaxed: the answer is a proof.
      const problem = tinyProblem()
      const baseline: PlanningBaselineV3 = {
        shifts: [
          {
            shiftId: "s1",
            employeeId: employee("e1"),
            date: "2026-07-20",
            segments: [{ startMinutes: 480, endMinutes: 600 }],
          },
        ],
      }
      const adapter = createCpSatAdapter({ timeoutSeconds: 30 })
      const response = await adapter(
        buildSolvePlanningRequest(
          problem,
          regeneration({ editedShifts: [{ shiftId: "s1", startMinute: 480, endMinute: 720 }] }),
          baseline
        )
      )

      // Only on a proof. The constraint was kept, CP-SAT exhausted the model,
      // and the answer is a demonstration rather than a relaxation.
      expect(response.outcome).toBe("infeasible")
      expect(response.solution).toBeNull()
      expect(response.metadata.optimality).toBe("none")
      expect(response.metadata.stopCause).toBe("exhausted")
      expect(response.diagnostics.entries[0].message).toContain("préservation")
      // Named, not blamed: the search never separated their contribution from
      // the week's own rigidity.
      const named = response.diagnostics.entries.find(
        (entry) => entry.code === "preservations-participating-in-infeasibility"
      )
      expect(named?.message).toContain("s1")
      expect(named?.message).toContain("nécessairement l'unique cause")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "refuse la requête plutôt que de résoudre sans un verrou introuvable",
    async () => {
      const problem = tinyProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 30 })
      const response = await adapter(
        buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["disparu"] }), {
          shifts: [],
        })
      )

      expect(response.outcome).toBe("invalid-problem")
      expect(response.solution).toBeNull()
      expect(response.metadata.stopCause).toBe("not-started")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "résout normalement quand la préservation est connue et compatible",
    async () => {
      // The counterpart of the refusals: a demand it CAN express becomes a hard
      // constraint and the week is solved with it, not around it.
      const problem = tinyProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 30 })
      const free = await adapter(buildSolvePlanningRequest(problem))
      const baseline = baselineOf(free.solution!)

      const response = await adapter(
        buildSolvePlanningRequest(
          problem,
          regeneration({ lockedShiftIds: baseline.shifts.map((shift) => shift.shiftId) }),
          baseline
        )
      )

      expect(response.solution).not.toBeNull()
      expect(response.metadata.unmetPreservations).toEqual([])
      // Every baseline shift was pinned, so the schedule must be the baseline.
      expect(response.solution!.assignments).toEqual(free.solution!.assignments)
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "ne rend jamais un planning ayant omis une préservation demandée",
    async () => {
      const problem = tinyProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 30 })
      const free = await adapter(buildSolvePlanningRequest(problem))
      const baseline = baselineOf(free.solution!)

      const requests = [
        // No baseline at all.
        buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["x"] })),
        // Unknown id.
        buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds: ["x"] }), baseline),
        // Illegal retouch.
        buildSolvePlanningRequest(
          problem,
          regeneration({
            editedShifts: [{ shiftId: baseline.shifts[0].shiftId, startMinute: 485, endMinute: 605 }],
          }),
          baseline
        ),
        // Perfectly usable lock.
        buildSolvePlanningRequest(
          problem,
          regeneration({ lockedShiftIds: [baseline.shifts[0].shiftId] }),
          baseline
        ),
      ]

      for (const request of requests) {
        const response = await adapter(request)
        if (response.solution !== null) {
          expect(response.metadata.respectedLocks).toBe(true)
          expect(response.metadata.respectedManualEdits).toBe(true)
        } else {
          expect(["invalid-problem", "infeasible"]).toContain(response.outcome)
        }
        expect(checkSolvePlanningResponse(response)).toEqual([])
      }
    },
    LONG
  )
})

describe.skipIf(!ENABLED)("CP-SAT réel — la semaine Drive", () => {
  it(
    "retrouve (1, 15, 24 750) sans aucune préservation",
    async () => {
      // Historically published as (1, 60, 99 000) — see cpsat-report.json.
      // Corrected 2026-07-24: the coverage check counted only a shift that
      // spans an ENTIRE demand slot, so Thursday's opening (06:00–07:00,
      // needs 2) charged the whole hour for a gap that really lasts 15
      // minutes (one employee starts 06:15 instead of 06:00). Level 1 is
      // unchanged — the SAME slot is still short — but levels 2 and 3 drop
      // by exactly 4x: 15 min instead of 60 (the atomic truth instead of the
      // whole window), and 15 × 1 650 = 24 750 instead of 60 × 1 650 = 99 000.
      // Proof-checked on this machine at timeoutSeconds: 500 per pass, all
      // three passes OPTIMAL — see the session's Drive replay.
      const problem = buildDriveProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 600 })
      const response = await adapter(buildSolvePlanningRequest(problem))

      expect(response.solution).not.toBeNull()
      expect(businessFigures(problem, response.solution!)).toEqual({
        underCoveredSlots: 1,
        deficitMinutes: 15,
        businessDeficitCost: 24_750,
      })
      // Drive ALLOWS split shifts and this model does not enumerate them, so the
      // space is incomplete and no optimum may be announced — however thoroughly
      // the three passes were proven.
      expect(response.metadata.candidateSpace).toBe("incomplete")
      expect(response.outcome).toBe("feasible")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "ne dégrade aucun des trois objectifs sous une préservation compatible",
    async () => {
      const problem = buildDriveProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 600 })

      const free = await adapter(buildSolvePlanningRequest(problem))
      const baseline = baselineOf(free.solution!)
      const pinned = baseline.shifts[0]

      const response = await adapter(
        buildSolvePlanningRequest(
          problem,
          regeneration({ lockedShiftIds: [pinned.shiftId], minimizeOtherChanges: true }),
          baseline
        )
      )

      // A lock taken FROM the reference solution cannot make it worse: the
      // reference itself is still available to the solver. See the note on
      // the previous test for why these are (1, 15, 24 750), not the
      // historical (1, 60, 99 000).
      expect(businessFigures(problem, response.solution!)).toEqual({
        underCoveredSlots: 1,
        deficitMinutes: 15,
        businessDeficitCost: 24_750,
      })
      expect(response.metadata.respectedLocks).toBe(true)
      expect(response.metadata.minimizedOtherChanges).toBe(true)
      expect(response.metadata.unmetPreservations).toEqual([])
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )
})

describe.skipIf(!ENABLED)("CP-SAT réel — arrêts et pannes", () => {
  it(
    "rend timeout-without-solution quand le budget expire avant toute solution",
    async () => {
      const problem = buildDriveProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 2 })
      const response = await adapter(buildSolvePlanningRequest(problem))

      expect(response.outcome).toBe("timeout-without-solution")
      expect(response.solution).toBeNull()
      expect(response.metadata.stopCause).toBe("timeout")
      // The distinction this outcome exists for.
      expect(response.outcome).not.toBe("infeasible")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "rend cancelled quand l'appelant coupe un processus en cours",
    async () => {
      const problem = buildDriveProblem()
      const signal = { aborted: false }
      const adapter = createCpSatAdapter({ timeoutSeconds: 600, signal })
      setTimeout(() => {
        signal.aborted = true
      }, 1_500)

      const response = await adapter(buildSolvePlanningRequest(problem))
      expect(response.outcome).toBe("cancelled")
      expect(response.metadata.stopCause).toBe("cancelled")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "rend backend-error quand l'interpréteur Python est introuvable",
    async () => {
      const adapter = createCpSatAdapter({
        pythonExecutable: "python-qui-nexiste-pas",
        timeoutSeconds: 10,
      })
      const response = await adapter(buildSolvePlanningRequest(tinyProblem()))

      expect(response.outcome).toBe("backend-error")
      expect(response.metadata.stopCause).toBe("backend-error")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )

  it(
    "rend backend-error quand le script est absent",
    async () => {
      const adapter = createCpSatAdapter({
        scriptPath: "experiments/planning-v3-cpsat/script-absent.py",
        timeoutSeconds: 10,
      })
      const response = await adapter(buildSolvePlanningRequest(tinyProblem()))

      expect(response.outcome).toBe("backend-error")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )
})

describe.skipIf(!ENABLED)("CP-SAT réel — une solution trouvée n'est jamais jetée", () => {
  it(
    "rend feasible avec un planning au budget applicatif, jamais timeout-without-solution",
    async () => {
      // The regression this whole diagnosis is about. The passes share one
      // budget; at the application's timeout the Drive week finishes its first
      // two lexicographic passes but not the third. The old service returned
      // `timeout-without-solution` and threw the proven schedule away; the fix
      // keeps it and answers `feasible`. A budget large enough for pass 1 to
      // complete is all this test needs — whether pass 3 also finishes only
      // decides between `feasible` and, on the incomplete Drive space, `feasible`
      // again, never a null solution.
      const problem = buildDriveProblem()
      const adapter = createCpSatAdapter({ timeoutSeconds: 120 })
      const response = await adapter(buildSolvePlanningRequest(problem))

      expect(response.outcome).not.toBe("timeout-without-solution")
      expect(response.outcome).toBe("feasible")
      expect(response.solution).not.toBeNull()
      expect(response.solution!.assignments.length).toBeGreaterThan(0)
      // Whatever it kept must survive the INDEPENDENT validator — the schedule
      // came from an earlier pass, not the final one, and nothing may reach the
      // manager unaudited.
      expect(response.diagnostics.blocking).toBe(false)
      expect(response.metadata.stopCause).toBe("timeout")
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )
})

describe.skipIf(!ENABLED)("CP-SAT réel — infaisabilité structurelle avant la recherche", () => {
  it(
    "refuse un budget journalier inatteignable sans lancer la recherche",
    async () => {
      // A day asking for more minutes than every available employee can supply
      // is provably impossible. The service must say so at once, not spend the
      // whole budget failing to disprove it. `not-started` is the tell: no pass
      // ran.
      const problem = structuredClone(buildDriveProblem()) as ReturnType<typeof buildDriveProblem>
      const open = problem.days.find((day) => !day.closed)!
      ;(open as { budgetMinutes: number }).budgetMinutes = 100_000

      const started = Date.now()
      const adapter = createCpSatAdapter({ timeoutSeconds: 600 })
      const response = await adapter(buildSolvePlanningRequest(problem))
      const elapsedSeconds = (Date.now() - started) / 1000

      expect(response.outcome).toBe("invalid-problem")
      expect(response.solution).toBeNull()
      expect(response.metadata.stopCause).toBe("not-started")
      expect(response.diagnostics.entries[0].code).toBe("structurally-infeasible")
      // The point of the check: it returns in seconds, nowhere near the budget.
      expect(elapsedSeconds).toBeLessThan(60)
      expect(checkSolvePlanningResponse(response)).toEqual([])
    },
    LONG
  )
})
