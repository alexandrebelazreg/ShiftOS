import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The V3 import frontier, enforced rather than documented.
 *
 * A validator that shares code with the generator agrees with it by
 * construction — including when both are wrong. That is the exact failure this
 * sprint exists to prevent, so the isolation is asserted here instead of being
 * left to reviewer discipline.
 *
 * The rule is checked by reading the V3 sources: a forbidden import cannot be
 * introduced without this test going red.
 */

const V3_ROOT = join(process.cwd(), "features", "core", "planning-v3")

/** Modules no V3 file may import, and why. */
const FORBIDDEN = [
  { fragment: "planning-generator/pipeline/business-pipeline", reason: "le pipeline métier V2" },
  { fragment: "pipeline/weekly-minute-allocator", reason: "l'allocateur hebdomadaire V2" },
  { fragment: "pipeline/weekly-distribution", reason: "la répartition hebdomadaire V2" },
  { fragment: "placeAllocatedWeek", reason: "le placeur hebdomadaire V2" },
  { fragment: "candidate-plan-validator", reason: "le validateur de plan V2" },
  { fragment: "planning-generator/strategies", reason: "les stratégies de génération V2" },
  { fragment: "planning-generator/generator", reason: "le générateur V2" },
  { fragment: "planning-generator/builders", reason: "les constructeurs V2" },
  { fragment: "planning-generator/validators", reason: "les validateurs V2" },
  { fragment: "react", reason: "React" },
  { fragment: "localStorage", reason: "un accès au stockage navigateur" },
  { fragment: "next/", reason: "Next.js" },
]

/** The validator is isolated more strictly than the rest of the module. */
const FORBIDDEN_IN_VALIDATOR = [
  { fragment: "planning-generator", reason: "tout module du générateur V2" },
  { fragment: "planning-v3/problem-builder", reason: "le constructeur de problème V3" },
]

/**
 * A solver may not consult its own auditor.
 *
 * The one exception is `validator/fingerprint`, which is a pure hash of a
 * problem or a solution: it decides nothing, reports nothing and cannot be
 * asked whether a schedule is legal. Everything else in `validator/` answers
 * exactly the question a solver must not be allowed to ask itself, because an
 * engine that can consult the validator can be written to satisfy it rather
 * than to satisfy the rules — and the two stop being the same thing the moment
 * either contains a bug.
 */
const VALIDATOR_MODULE = "planning-v3/validator"
const VALIDATOR_FINGERPRINT = "planning-v3/validator/fingerprint"

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path)
    }
    return path.endsWith(".ts") ? [path] : []
  })
}

function importsOf(path: string): string[] {
  const source = readFileSync(path, "utf8")
  return [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1])
}

describe("frontière d'import de Planning V3", () => {
  const files = sourceFiles(V3_ROOT)

  it("couvre bien les sources du module", () => {
    expect(files.length).toBeGreaterThanOrEqual(13)
  })

  it("n'importe aucun moteur de placement ni aucune dépendance UI", () => {
    const offences: string[] = []
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        for (const rule of FORBIDDEN) {
          if (specifier.includes(rule.fragment)) {
            offences.push(`${file} importe ${rule.reason} (${specifier})`)
          }
        }
      }
    }
    expect(offences).toEqual([])
  })

  it("garde le validateur indépendant du générateur et du constructeur", () => {
    const offences: string[] = []
    for (const file of files.filter((path) => path.includes("validator"))) {
      for (const specifier of importsOf(file)) {
        for (const rule of FORBIDDEN_IN_VALIDATOR) {
          if (specifier.includes(rule.fragment)) {
            offences.push(`${file} importe ${rule.reason} (${specifier})`)
          }
        }
      }
    }
    expect(offences).toEqual([])
  })

  it("interdit aux solveurs d'importer le validateur, sauf l'empreinte", () => {
    const offences: string[] = []
    for (const file of files.filter(
      (path) => path.includes("solver") || path.includes("solver-decomposed")
    )) {
      for (const specifier of importsOf(file)) {
        if (!specifier.includes(VALIDATOR_MODULE)) continue
        if (specifier.includes(VALIDATOR_FINGERPRINT)) continue
        offences.push(`${file} importe le validateur V3 (${specifier})`)
      }
    }
    expect(offences).toEqual([])
  })

  it("couvre bien le moteur décomposé", () => {
    const decomposed = files.filter((path) => path.includes("solver-decomposed"))
    expect(decomposed.length).toBeGreaterThanOrEqual(8)
  })

  it("n'autorise le générateur V2 que comme types d'entrée du constructeur", () => {
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        if (!specifier.includes("planning-generator")) continue
        // Only the builder translates from V2, and only from its type modules.
        expect(file).toContain("problem-builder")
        expect(specifier).toContain("planning-generator/types/")
      }
    }
  })
})
