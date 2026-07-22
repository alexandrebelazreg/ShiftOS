import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

/**
 * The modification legend was removed: the badges next to each employee now
 * carry their own meaning. This guards against it creeping back — both the
 * component and its explanatory text must stay gone from the board.
 */
const boardDir = join(dirname(fileURLToPath(import.meta.url)), "..")

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

describe("légende des modifications — retirée de l'UI", () => {
  const files = walk(boardDir)

  it("ne conserve aucun composant de légende", () => {
    expect(files.some((path) => path.endsWith("PlanningEditLegend.tsx"))).toBe(false)
  })

  it("ne conserve aucun texte de légende dans le board", () => {
    const offenders = files
      .filter((path) => /\.(ts|tsx)$/.test(path) && !path.includes("__tests__"))
      .filter((path) => readFileSync(path, "utf8").includes("Légende des modifications"))
    expect(offenders).toEqual([])
  })
})
