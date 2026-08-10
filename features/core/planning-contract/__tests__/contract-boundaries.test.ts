import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The contract's import frontier, enforced rather than documented.
 *
 * A contract that quietly imports a solver is not a contract, it is a facade
 * over one: the day CP-SAT replaces the prototype, every module that merely
 * named `SolvePlanningResponse` would have to be revisited. And a contract that
 * imports the UI inverts the dependency it exists to create — the board depends
 * on the contract, never the reverse.
 *
 * Both rules are asserted here by reading the sources, so neither can be broken
 * without this test going red.
 */

const CONTRACT_ROOT = join(process.cwd(), "features", "core", "planning-contract")
const ADAPTERS = `${sep}adapters${sep}`

/** Forbidden everywhere in the module, adapters included. */
const FORBIDDEN = [
  { fragment: "react", reason: "React" },
  { fragment: "next/", reason: "Next.js" },
  { fragment: "localStorage", reason: "un accès au stockage navigateur" },
  { fragment: "@/components", reason: "un composant d'interface" },
  { fragment: "@/app", reason: "la couche applicative Next.js" },
  { fragment: "features/planning/", reason: "la feature d'interface Planning" },
  { fragment: "experiments/", reason: "un spike non versionné comme du produit" },
]

/**
 * Forbidden OUTSIDE `adapters/`. The adapters exist precisely to name an
 * engine; nothing else in the module may.
 */
const FORBIDDEN_OUTSIDE_ADAPTERS = [
  { fragment: "planning-v3/solver", reason: "le solveur V3" },
  { fragment: "planning-v3/orchestrator", reason: "l'orchestrateur V3" },
  { fragment: "planning-v3/validator", reason: "le validateur V3" },
  { fragment: "planning-v3/problem-builder", reason: "le constructeur de problème V3" },
  { fragment: "planning-v3/adapter", reason: "le sélecteur de moteur V3" },
  { fragment: "planning-generator", reason: "le générateur V2" },
]

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

describe("frontière d'import du contrat de planification", () => {
  const files = sourceFiles(CONTRACT_ROOT)

  it("couvre bien les sources du module", () => {
    expect(files.length).toBeGreaterThanOrEqual(9)
  })

  it("n'importe ni React, ni Next, ni le stockage, ni une feature d'interface", () => {
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

  it("ne laisse aucun moteur entrer dans le contrat lui-même", () => {
    const offences: string[] = []
    for (const file of files.filter((path) => !path.includes(ADAPTERS))) {
      for (const specifier of importsOf(file)) {
        for (const rule of FORBIDDEN_OUTSIDE_ADAPTERS) {
          if (specifier.includes(rule.fragment)) {
            offences.push(`${file} importe ${rule.reason} (${specifier})`)
          }
        }
      }
    }
    expect(offences).toEqual([])
  })

  it("n'autorise Planning V3 hors adaptateurs que comme types de problème et de solution", () => {
    for (const file of files.filter((path) => !path.includes(ADAPTERS))) {
      for (const specifier of importsOf(file)) {
        if (!specifier.includes("planning-v3")) continue
        expect(specifier).toMatch(/planning-v3\/types\/(problem|solution)$/)
      }
    }
  })

  it("ne réexporte pas les adaptateurs depuis le barrel du contrat", () => {
    // Importing a type from the contract must never pull a search engine into
    // the bundle. Reaching an engine is an explicit, one-line decision made by
    // the composition layer.
    const reexported = importsOf(join(CONTRACT_ROOT, "index.ts"))
    expect(reexported.filter((specifier) => specifier.includes("adapters"))).toEqual([])
  })

  it("ne réexporte pas CP-SAT depuis le barrel des adaptateurs", () => {
    // CP-SAT reaches `node:child_process`, which cannot be bundled for a
    // browser. One re-export from this barrel would break every UI module that
    // only wanted a type from it.
    const reexported = importsOf(join(CONTRACT_ROOT, "adapters", "index.ts"))
    expect(reexported.filter((specifier) => specifier.includes("highs-fast"))).toEqual([])
  })

  it("confine les API Node au seul adaptateur qui en a besoin", () => {
    const offenders = files
      .filter((file) => importsOf(file).some((specifier) => specifier.startsWith("node:")))
      .map((file) => file.replace(CONTRACT_ROOT, ""))
    // Exactly one file may touch the OS, and it is the process boundary. It
    // used to sit inside the CP-SAT adapter; it moved when that engine was
    // deleted, because the transport was never CP-SAT's — it is what any Python
    // engine needs.
    expect(offenders).toEqual([join(sep, "adapters", "python", "run-python.ts")])
  })
})

/**
 * The other half of the promise: the UI must not know which engine answered.
 *
 * A component that imports an adapter has learned the name of an engine, and
 * with it a reason to branch on one. The contract's whole value is that no such
 * component can exist, so its absence is checked rather than trusted.
 */
describe("l'interface ne connaît aucun moteur", () => {
  const PLANNING_UI = join(process.cwd(), "features", "planning")

  function componentFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        return entry === "__tests__" ? [] : componentFiles(path)
      }
      return path.endsWith(".tsx") ? [path] : []
    })
  }

  it("aucun composant React n'importe un adaptateur de moteur", () => {
    const offences = componentFiles(PLANNING_UI).filter((file) => {
      const specifiers = importsOf(file)
      return specifiers.some(
        (specifier) =>
          specifier.includes("planning-contract/adapters") ||
          specifier.includes("planning-v3/solver") ||
          specifier.includes("planning-v3/orchestrator") ||
          specifier.includes("planning-generator/generator")
      )
    })
    expect(offences).toEqual([])
  })
})
