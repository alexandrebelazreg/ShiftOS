import { describe, expect, it } from "vitest"

import { applyLocks } from "@/features/core/planning-contract/locks"
import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"
import type { PlanningRegenerationRequest } from "@/features/core/planning-contract/types/regeneration"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"

/**
 * Ce qu'un verrou devient, et ce qu'il ne devient pas.
 *
 * La propriété centrale est négative : **un verrou qu'on ne peut pas tenir
 * exactement doit être refusé, jamais approché.** Un gérant qui voit son
 * créneau bouger après l'avoir verrouillé cesse de se servir du verrou — et
 * c'est une fonctionnalité perdue pour de bon, pas seulement une gêne.
 */

const problem = tinyProblem() as PlanningProblemV3
const cell = problem.employeeDays[0]

function baselineWith(
  segments: readonly { startMinutes: number; endMinutes: number }[],
  shiftId = "s1"
): PlanningBaselineV3 {
  return {
    shifts: [{ shiftId, employeeId: cell.employeeId, date: cell.date, segments }],
  }
}

function request(lockedShiftIds: readonly string[]): PlanningRegenerationRequest {
  return {
    preserveLockedShifts: true,
    preserveManualEdits: false,
    minimizeOtherChanges: false,
    lockedShiftIds,
    editedShifts: [],
  }
}

function pinned(result: ReturnType<typeof applyLocks>) {
  return result.problem.employeeDays.find(
    (entry) => entry.employeeId === cell.employeeId && entry.date === cell.date
  )
}

describe("un verrou devient une journée épinglée", () => {
  it("fige le début et la fin du créneau verrouillé", () => {
    const result = applyLocks(
      problem,
      request(["s1"]),
      baselineWith([{ startMinutes: 540, endMinutes: 900 }])
    )
    expect(result.honoured).toEqual(["s1"])
    expect(result.refused).toEqual([])
    expect(pinned(result)?.fixedStartMinutes).toBe(540)
    expect(pinned(result)?.fixedEndMinutes).toBe(900)
  })

  it("ne touche à rien quand le gérant n'a rien verrouillé", () => {
    const result = applyLocks(problem, request([]), baselineWith([{ startMinutes: 540, endMinutes: 900 }]))
    expect(result.problem).toBe(problem)
    expect(result.honoured).toEqual([])
  })

  it("ne touche à rien quand la préservation n'est pas demandée", () => {
    const result = applyLocks(
      problem,
      { ...request(["s1"]), preserveLockedShifts: false },
      baselineWith([{ startMinutes: 540, endMinutes: 900 }])
    )
    expect(result.problem).toBe(problem)
  })
})

describe("ce qu'un verrou ne doit pas devenir", () => {
  it("refuse plutôt que de deviner, sans semaine de référence", () => {
    // Un identifiant seul ne désigne aucune heure. Épingler « quelque part »
    // serait pire que renoncer : le gérant croirait son créneau tenu.
    const result = applyLocks(problem, request(["s1"]), null)
    expect(result.honoured).toEqual([])
    expect(result.refused).toHaveLength(1)
    expect(result.refused[0].reason).toContain("référence")
  })

  it("refuse un créneau coupé, dont la coupure resterait déplaçable", () => {
    // Figer le début et la fin fixerait l'amplitude, pas la position de la
    // coupure. « Exactement là » deviendrait faux sans que rien ne le dise.
    const result = applyLocks(
      problem,
      request(["s1"]),
      baselineWith([
        { startMinutes: 480, endMinutes: 720 },
        { startMinutes: 840, endMinutes: 1020 },
      ])
    )
    expect(result.honoured).toEqual([])
    expect(result.refused[0].reason).toContain("coupé")
    expect(pinned(result)?.fixedStartMinutes).toBeUndefined()
  })

  it("refuse un créneau qui n'est plus dans la semaine affichée", () => {
    const result = applyLocks(
      problem,
      request(["disparu"]),
      baselineWith([{ startMinutes: 540, endMinutes: 900 }])
    )
    expect(result.refused[0].shiftId).toBe("disparu")
    expect(result.refused[0].reason).toContain("plus dans la semaine")
  })

  it("refuse LES DEUX quand deux verrous visent la même journée", () => {
    // Départager reviendrait à choisir à la place du gérant — et il ne saurait
    // pas lequel a gagné.
    const baseline: PlanningBaselineV3 = {
      shifts: [
        { shiftId: "a", employeeId: cell.employeeId, date: cell.date, segments: [{ startMinutes: 540, endMinutes: 720 }] },
        { shiftId: "b", employeeId: cell.employeeId, date: cell.date, segments: [{ startMinutes: 780, endMinutes: 960 }] },
      ],
    }
    const result = applyLocks(problem, request(["a", "b"]), baseline)
    expect(result.honoured).toEqual([])
    expect(result.refused.map((r) => r.shiftId).sort()).toEqual(["a", "b"])
    expect(pinned(result)?.fixedStartMinutes).toBeUndefined()
  })

  it("laisse la fiche du salarié l'emporter sur le verrou", () => {
    // Le contrat n'est pas une préférence qu'un clic écrase. La base dirait non
    // plus tard de toute façon ; autant le dire tout de suite, et clairement.
    const withRule: PlanningProblemV3 = {
      ...problem,
      employeeDays: problem.employeeDays.map((entry) =>
        entry === cell ? { ...entry, fixedStartMinutes: 480 } : entry
      ),
    }
    const result = applyLocks(
      withRule,
      request(["s1"]),
      baselineWith([{ startMinutes: 540, endMinutes: 900 }])
    )
    expect(result.honoured).toEqual([])
    expect(result.refused[0].reason).toContain("fiche")
  })

  it("refuse un verrou dont la journée n'existe pas dans le problème", () => {
    const elsewhere: PlanningBaselineV3 = {
      shifts: [
        {
          shiftId: "s1",
          employeeId: cell.employeeId,
          date: "2099-01-01" as (typeof cell)["date"],
          segments: [{ startMinutes: 540, endMinutes: 900 }],
        },
      ],
    }
    const result = applyLocks(problem, request(["s1"]), elsewhere)
    expect(result.honoured).toEqual([])
    expect(result.refused[0].reason).toContain("planifiable")
  })
})
