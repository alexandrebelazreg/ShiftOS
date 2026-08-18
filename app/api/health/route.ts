import { existsSync } from "node:fs"

import { resolveHighsFastPython } from "@/features/core/planning-contract/adapters/python/run-python"

/**
 * The liveness probe, for the platform that restarts this container.
 *
 * It answers two questions, not one. That the Node server is up is the easy
 * half; the half that actually fails is whether the Python interpreter that
 * carries numpy and scipy is where the adapter expects it. An image can build,
 * boot and serve every page while being INCAPABLE of generating a single
 * schedule — the failure that matters here is silent, and a probe that only
 * checks the HTTP port would report that container as healthy.
 *
 * Deliberately does NOT spawn Python. A probe polled every few seconds must
 * cost nothing, and a process launch on each call would compete with a real
 * solve for the same CPU. Existence on disk is what distinguishes a broken
 * image from a working one; a crash mid-solve is the adapter's business, not
 * the platform's.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(): Response {
  const python = resolveHighsFastPython()
  // `resolveHighsFastPython` falls back to a bare "python" when it finds no
  // interpreter of its own. In a container that fallback is exactly the
  // misconfiguration to report: it means PLANNING_HIGHS_PYTHON was not set and
  // no venv was found, so the solver would run against whatever the PATH holds.
  const solverReady = python !== "python" && existsSync(python)

  return Response.json(
    { status: solverReady ? "ok" : "degraded", solver: solverReady ? "ready" : "unreachable" },
    { status: solverReady ? 200 : 503 }
  )
}
