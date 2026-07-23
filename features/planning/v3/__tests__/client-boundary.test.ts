import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * CP-SAT must not exist in the browser bundle. Enforced, not documented.
 *
 * The adapter spawns Python through `node:child_process`. One import of it from
 * anything the client reaches — a component, a hook, a barrel a component
 * imports — and the build either breaks or, worse, quietly ships a module that
 * cannot run where it landed. The frontier is the whole reason the route
 * handler exists, so its integrity is asserted here instead of being left to
 * whoever adds the next import.
 */

const ROOT = process.cwd()

/** Everything a browser can reach: the planning feature and the app shell. */
const CLIENT_REACHABLE = [
  join(ROOT, "features", "planning"),
  join(ROOT, "components"),
]

const FORBIDDEN_IN_CLIENT = [
  { fragment: "node:", reason: "une API Node" },
  { fragment: "child_process", reason: "l'exécution d'un processus" },
  { fragment: "planning-contract/adapters", reason: "un adaptateur de moteur" },
  { fragment: "experiments/", reason: "le spike CP-SAT" },
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path)
    }
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : []
  })
}

function importsOf(path: string): string[] {
  const source = readFileSync(path, "utf8")
  return [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1])
}

describe("frontière client / serveur du moteur V3", () => {
  const files = CLIENT_REACHABLE.flatMap(sourceFiles)

  it("couvre bien les sources atteignables depuis le navigateur", () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it("n'expose aucun adaptateur de moteur ni aucune API Node au client", () => {
    const offences: string[] = []
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        for (const rule of FORBIDDEN_IN_CLIENT) {
          if (specifier.includes(rule.fragment)) {
            offences.push(`${file.replace(ROOT, "")} importe ${rule.reason} (${specifier})`)
          }
        }
      }
    }
    expect(offences).toEqual([])
  })

  it("ne laisse le module V3 parler que JSON", () => {
    // It builds a problem, posts it, and reads a response. Anything else would
    // mean the boundary had leaked back into the client.
    const v3Files = sourceFiles(join(ROOT, "features", "planning", "v3"))
    expect(v3Files.length).toBeGreaterThanOrEqual(5)
    for (const file of v3Files) {
      for (const specifier of importsOf(file)) {
        expect(specifier).not.toContain("adapters/cp-sat")
        expect(specifier).not.toContain("node:")
      }
    }
  })
})

describe("la route serveur est le seul point d'entrée de CP-SAT", () => {
  function appFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) return appFiles(path)
      return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : []
    })
  }

  const files = appFiles(join(ROOT, "app"))

  it("n'importe l'adaptateur CP-SAT que depuis la route de résolution", () => {
    const importers = files.filter((file) =>
      importsOf(file).some((specifier) => specifier.includes("adapters/cp-sat"))
    )
    expect(importers.map((file) => file.replace(ROOT, "").replace(/\\/g, "/"))).toEqual([
      "/app/api/planning/v3/solve/route.ts",
    ])
  })

  it("déclare explicitement le runtime Node sur cette route", () => {
    // The default today, stated anyway: the day this is deployed to an edge
    // runtime it must fail at build time, not at the first manager who clicks.
    const route = readFileSync(join(ROOT, "app", "api", "planning", "v3", "solve", "route.ts"), "utf8")
    expect(route).toContain('export const runtime = "nodejs"')
    expect(route).toContain("export const maxDuration")
  })

  it("ne rend jamais une infaisabilité depuis un refus de frontière", () => {
    const route = readFileSync(join(ROOT, "app", "api", "planning", "v3", "solve", "route.ts"), "utf8")
    const refusals = route.slice(route.indexOf("export async function POST"))
    expect(refusals).not.toContain('"infeasible"')
  })
})
