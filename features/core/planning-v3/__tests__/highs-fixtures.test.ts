import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { serialiseDriveCanonicalProblem } from "@/features/core/planning-v3/__tests__/drive-canonical"
import { serialiseAccueilCanonicalProblem } from "@/features/core/planning-v3/__tests__/accueil-canonical"
import { serialiseDriveWithAbsencesProblem } from "@/features/core/planning-v3/__tests__/drive-absences"

/**
 * The problem snapshots the Python solver reads.
 *
 * A snapshot rots silently: change a rule, the builder or a fixture and the
 * committed file quietly stops describing the problem the application poses,
 * while the solver keeps reporting a result about the OLD one — and the result
 * reads as if it still applied. Each file is regenerated here from the real
 * builder and compared byte for byte.
 *
 * Set `UPDATE_HIGHS_FIXTURES=1` to rewrite them after an intended change:
 *
 *     UPDATE_HIGHS_FIXTURES=1 npx vitest run features/core/planning-v3/__tests__/highs-fixtures.test.ts
 */

const ROOT = join(process.cwd(), "experiments", "planning-v3-highs", "fixtures")
const UPDATE = process.env.UPDATE_HIGHS_FIXTURES === "1"

const SNAPSHOTS = [
  ["drive-canonical-problem.json", serialiseDriveCanonicalProblem],
  ["accueil-canonical-problem.json", serialiseAccueilCanonicalProblem],
  ["drive-absences-problem.json", serialiseDriveWithAbsencesProblem],
] as const

describe("fixtures partagées avec le solveur HiGHS", () => {
  for (const [name, serialise] of SNAPSHOTS) {
    it(`${name} décrit toujours le problème que le builder produit`, () => {
      const regenerated = serialise()
      const path = join(ROOT, name)

      if (UPDATE) writeFileSync(path, regenerated, "utf8")

      expect(existsSync(path)).toBe(true)
      const committed = readFileSync(path, "utf8")

      // Les valeurs d'abord — le diff est lisible — puis le texte exact, qui
      // attrape une dérive de format que Python lirait différemment.
      expect(JSON.parse(committed)).toEqual(JSON.parse(regenerated))
      expect(committed).toBe(regenerated)
    })
  }
})
