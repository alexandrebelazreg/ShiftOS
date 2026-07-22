import { describe, expect, it } from "vitest"

import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"

import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"
import type { PlanningRegenerationRequest } from "@/features/core/planning-contract/types/regeneration"
import { requestedPreservations } from "@/features/core/planning-contract/types/solve-request"

const problem = tinyProblem()

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

describe("buildSolvePlanningRequest — première génération", () => {
  it("porte le problème et rien d'autre quand il n'y a pas de travail local", () => {
    const request = buildSolvePlanningRequest(problem)
    expect(request.problem).toBe(problem)
    expect(request.regeneration).toBeUndefined()
    expect(Object.keys(request)).toEqual(["problem"])
  })

  it("traite null comme l'absence de régénération", () => {
    expect(buildSolvePlanningRequest(problem, null).regeneration).toBeUndefined()
  })

  it("ne recopie ni ne gèle le problème, qui appartient à l'appelant", () => {
    // Freezing another module's object graph as a side effect is a worse hazard
    // than the one it prevents: the problem is already immutable by type.
    expect(buildSolvePlanningRequest(problem).problem).toBe(problem)
  })
})

describe("buildSolvePlanningRequest — forme canonique", () => {
  it("trie et dédoublonne les verrous", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["s3", "s1", "s2", "s1"] })
    )
    expect(request.regeneration?.lockedShiftIds).toEqual(["s1", "s2", "s3"])
  })

  it("trie les modifications par identifiant de shift", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({
        editedShifts: [
          { shiftId: "s2", startMinute: 600, endMinute: 780 },
          { shiftId: "s1", startMinute: 480, endMinute: 720 },
        ],
      })
    )
    expect(request.regeneration?.editedShifts).toEqual([
      { shiftId: "s1", startMinute: 480, endMinute: 720 },
      { shiftId: "s2", startMinute: 600, endMinute: 780 },
    ])
  })

  it("garde la dernière géométrie d'un shift décrit deux fois", () => {
    // Two entries for one shift are two contradictory geometries; handing both
    // to a solver is not an option, and the later one is the more recent intent.
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({
        editedShifts: [
          { shiftId: "s1", startMinute: 480, endMinute: 720 },
          { shiftId: "s1", startMinute: 510, endMinute: 690 },
        ],
      })
    )
    expect(request.regeneration?.editedShifts).toEqual([
      { shiftId: "s1", startMinute: 510, endMinute: 690 },
    ])
  })

  it("ne laisse passer aucun champ non déclaré vers le moteur", () => {
    const smuggled = {
      shiftId: "s1",
      startMinute: 480,
      endMinute: 720,
      employeeId: "e1",
    } as unknown as PlanningRegenerationRequest["editedShifts"][number]

    const request = buildSolvePlanningRequest(problem, regeneration({ editedShifts: [smuggled] }))
    expect(Object.keys(request.regeneration!.editedShifts[0])).toEqual([
      "shiftId",
      "startMinute",
      "endMinute",
    ])
  })

  it("conserve une géométrie dégénérée au lieu de la masquer", () => {
    // Dropping it would hide a caller's bug behind a plausible-looking request.
    // Rejecting it is the validator's job, not the builder's.
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ editedShifts: [{ shiftId: "s1", startMinute: 720, endMinute: 480 }] })
    )
    expect(request.regeneration?.editedShifts).toEqual([
      { shiftId: "s1", startMinute: 720, endMinute: 480 },
    ])
  })

  it("recopie fidèlement les trois intentions", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({
        preserveLockedShifts: false,
        preserveManualEdits: true,
        minimizeOtherChanges: true,
      })
    )
    expect(request.regeneration?.preserveLockedShifts).toBe(false)
    expect(request.regeneration?.preserveManualEdits).toBe(true)
    expect(request.regeneration?.minimizeOtherChanges).toBe(true)
  })

  it("garde la régénération vide, parce que minimizeOtherChanges est une intention", () => {
    const request = buildSolvePlanningRequest(problem, regeneration({ minimizeOtherChanges: true }))
    expect(request.regeneration).toBeDefined()
    expect(request.regeneration?.lockedShiftIds).toEqual([])
  })

  it("est déterministe : deux ordres d'entrée donnent la même requête", () => {
    const edits = [
      { shiftId: "s2", startMinute: 600, endMinute: 780 },
      { shiftId: "s1", startMinute: 480, endMinute: 720 },
    ]
    const left = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["b", "a"], editedShifts: edits })
    )
    const right = buildSolvePlanningRequest(
      problem,
      regeneration({ lockedShiftIds: ["a", "b"], editedShifts: [...edits].reverse() })
    )
    expect(left).toEqual(right)
  })
})

describe("buildSolvePlanningRequest — planning de référence", () => {
  const shift = (shiftId: string, start: number, end: number) => ({
    shiftId,
    employeeId: "e1" as unknown as PlanningBaselineV3["shifts"][number]["employeeId"],
    date: "2026-07-20",
    segments: [{ startMinutes: start, endMinutes: end }],
  })

  it("reste absent quand la requête n'en porte pas", () => {
    expect(buildSolvePlanningRequest(problem).baseline).toBeUndefined()
    expect(buildSolvePlanningRequest(problem, regeneration()).baseline).toBeUndefined()
  })

  it("accompagne une première génération si l'appelant en fournit un", () => {
    const request = buildSolvePlanningRequest(problem, null, { shifts: [shift("s1", 480, 600)] })
    expect(request.baseline?.shifts).toHaveLength(1)
  })

  it("dédoublonne par identifiant, parce qu'un verrou nomme un identifiant", () => {
    // Two shifts sharing an id would make "keep s1 exactly where it is"
    // ambiguous, which is the one thing a lock may never be.
    const request = buildSolvePlanningRequest(problem, regeneration(), {
      shifts: [shift("s1", 480, 600), shift("s1", 540, 660)],
    })
    expect(request.baseline?.shifts).toEqual([
      { shiftId: "s1", employeeId: "e1", date: "2026-07-20", segments: [{ startMinutes: 540, endMinutes: 660 }] },
    ])
  })

  it("trie les shifts et leurs segments, pour une dérive reproductible", () => {
    const request = buildSolvePlanningRequest(problem, regeneration(), {
      shifts: [
        shift("s2", 600, 720),
        {
          ...shift("s1", 0, 0),
          segments: [
            { startMinutes: 600, endMinutes: 660 },
            { startMinutes: 480, endMinutes: 540 },
          ],
        },
      ],
    })
    expect(request.baseline?.shifts.map((entry) => entry.shiftId)).toEqual(["s1", "s2"])
    expect(request.baseline?.shifts[0].segments).toEqual([
      { startMinutes: 480, endMinutes: 540 },
      { startMinutes: 600, endMinutes: 660 },
    ])
  })

  it("gèle le planning de référence comme le reste de la requête", () => {
    const request = buildSolvePlanningRequest(problem, regeneration(), {
      shifts: [shift("s1", 480, 600)],
    })
    expect(Object.isFrozen(request.baseline)).toBe(true)
    expect(Object.isFrozen(request.baseline?.shifts)).toBe(true)
    expect(Object.isFrozen(request.baseline?.shifts[0])).toBe(true)
    expect(Object.isFrozen(request.baseline?.shifts[0].segments)).toBe(true)
  })
})

describe("buildSolvePlanningRequest — immuabilité", () => {
  const request = buildSolvePlanningRequest(
    problem,
    regeneration({
      lockedShiftIds: ["s1"],
      editedShifts: [{ shiftId: "s1", startMinute: 480, endMinute: 720 }],
    })
  )

  it("gèle la requête, la régénération et chaque collection", () => {
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.regeneration)).toBe(true)
    expect(Object.isFrozen(request.regeneration?.lockedShiftIds)).toBe(true)
    expect(Object.isFrozen(request.regeneration?.editedShifts)).toBe(true)
    expect(Object.isFrozen(request.regeneration?.editedShifts[0])).toBe(true)
  })

  it("refuse toute mutation à l'exécution, pas seulement à la compilation", () => {
    const mutable = request as unknown as { problem: unknown; regeneration?: unknown }
    expect(() => {
      mutable.problem = null
    }).toThrow(TypeError)
    expect(() => {
      ;(request.regeneration!.lockedShiftIds as string[]).push("s2")
    }).toThrow(TypeError)
    expect(() => {
      ;(request.regeneration!.editedShifts[0] as { startMinute: number }).startMinute = 0
    }).toThrow(TypeError)
  })

  it("se détache de l'état source : une requête en vol ne peut pas changer sous le solveur", () => {
    const lockedShiftIds = ["s1"]
    const editedShifts = [{ shiftId: "s1", startMinute: 480, endMinute: 720 }]
    const detached = buildSolvePlanningRequest(problem, regeneration({ lockedShiftIds, editedShifts }))

    lockedShiftIds.push("s2")
    editedShifts.push({ shiftId: "s2", startMinute: 0, endMinute: 60 })
    editedShifts[0].startMinute = 999

    expect(detached.regeneration?.lockedShiftIds).toEqual(["s1"])
    expect(detached.regeneration?.editedShifts).toEqual([
      { shiftId: "s1", startMinute: 480, endMinute: 720 },
    ])
  })
})

describe("requestedPreservations — ce que la requête exige vraiment", () => {
  it("n'exige rien sans régénération", () => {
    expect(requestedPreservations(buildSolvePlanningRequest(problem))).toEqual({
      locks: false,
      manualEdits: false,
      minimizeOtherChanges: false,
      none: true,
    })
  })

  it("n'exige rien d'un drapeau sans travail local", () => {
    // A flag alone is not a demand: an engine reporting "locks not respected"
    // for an empty lock set would be crying wolf.
    const request = buildSolvePlanningRequest(problem, regeneration())
    expect(requestedPreservations(request).locks).toBe(false)
    expect(requestedPreservations(request).none).toBe(true)
  })

  it("n'exige rien d'un travail local que le manager a choisi de ne pas garder", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({ preserveLockedShifts: false, lockedShiftIds: ["s1"] })
    )
    expect(requestedPreservations(request).locks).toBe(false)
  })

  it("exige la préservation quand le drapeau et le travail local coexistent", () => {
    const request = buildSolvePlanningRequest(
      problem,
      regeneration({
        lockedShiftIds: ["s1"],
        editedShifts: [{ shiftId: "s2", startMinute: 480, endMinute: 720 }],
        minimizeOtherChanges: true,
      })
    )
    expect(requestedPreservations(request)).toEqual({
      locks: true,
      manualEdits: true,
      minimizeOtherChanges: true,
      none: false,
    })
  })
})
