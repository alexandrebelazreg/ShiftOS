import { existsSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { createHighsFastAdapter } from "@/features/core/planning-contract/adapters/highs-fast"
import { resolveHighsFastPython } from "@/features/core/planning-contract/adapters/python/run-python"
import type { PlanningBaselineV3 } from "@/features/core/planning-contract/types/baseline"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import { buildAccueilCanonicalProblem } from "@/features/core/planning-v3/__tests__/accueil-canonical"

/**
 * Un verrou revient-il là où on l'a mis ?
 *
 * Aucun test de traduction ne peut répondre : ils prouvent que le problème
 * envoyé porte les bonnes heures imposées, pas que le moteur les honore. Seul
 * un aller-retour complet — vrai sous-processus, vrai solveur — le dit.
 *
 * C'est la promesse entière de la fonctionnalité : le gérant verrouille, il
 * régénère, et son créneau n'a pas bougé. Elle se vérifie ici ou nulle part.
 *
 * IGNORÉ quand l'environnement Python de l'expérience est absent, pour qu'un
 * clone qui n'a jamais installé scipy reste vert.
 */

const python = resolveHighsFastPython()
const available = python !== "python" && existsSync(python)

describe("verrous — bout en bout, vrai solveur", () => {
  it.skipIf(!available)(
    "rend le créneau verrouillé exactement où il était",
    async () => {
      const problem = buildAccueilCanonicalProblem()
      const adapter = createHighsFastAdapter({ timeoutSeconds: 60 })

      // Une première résolution SANS verrou : elle produit la semaine dont on
      // va extraire le créneau à figer. Verrouiller une heure inventée ne
      // prouverait rien — le moteur pourrait la refuser pour de bonnes raisons.
      const first = await adapter({ problem } as SolvePlanningRequest)
      expect(first.solution).not.toBeNull()

      const reference = first.solution!.assignments.find(
        (assignment) => assignment.segments.length === 1
      )
      expect(reference, "aucune journée continue à verrouiller").toBeDefined()

      const baseline: PlanningBaselineV3 = {
        shifts: [
          {
            shiftId: "verrou",
            employeeId: reference!.employeeId,
            date: reference!.date,
            segments: reference!.segments,
          },
        ],
      }

      const second = await adapter({
        problem,
        regeneration: {
          preserveLockedShifts: true,
          preserveManualEdits: false,
          minimizeOtherChanges: false,
          lockedShiftIds: ["verrou"],
          editedShifts: [],
        },
        baseline,
      } as SolvePlanningRequest)

      expect(second.solution, "la semaine verrouillée n'a produit aucun planning").not.toBeNull()

      const kept = second.solution!.assignments.find(
        (assignment) =>
          assignment.employeeId === reference!.employeeId && assignment.date === reference!.date
      )
      expect(kept, "la journée verrouillée a disparu du planning").toBeDefined()

      // La promesse, littéralement : mêmes minutes qu'avant.
      expect(kept!.segments[0].startMinutes).toBe(reference!.segments[0].startMinutes)
      expect(kept!.segments[kept!.segments.length - 1].endMinutes).toBe(
        reference!.segments[0].endMinutes
      )
    },
    180_000
  )

  it.skipIf(!available)(
    "n'annonce pas un verrou tenu quand il a été refusé",
    async () => {
      const problem = buildAccueilCanonicalProblem()
      const adapter = createHighsFastAdapter({ timeoutSeconds: 30 })

      // Un identifiant qui ne désigne rien dans la semaine de référence.
      const response = await adapter({
        problem,
        regeneration: {
          preserveLockedShifts: true,
          preserveManualEdits: false,
          minimizeOtherChanges: false,
          lockedShiftIds: ["inexistant"],
          editedShifts: [],
        },
        baseline: { shifts: [] },
      } as SolvePlanningRequest)

      // Ce qui compte n'est pas que la résolution passe : c'est qu'elle ne
      // prétende pas avoir tenu ce qu'elle n'a pas tenu.
      expect(response.diagnostics.entries.some((entry) => entry.code === "lock-refused")).toBe(true)
    },
    120_000
  )
})
