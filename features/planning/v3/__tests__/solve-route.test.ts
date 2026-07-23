import { describe, expect, it } from "vitest"

import { tinyProblem } from "@/features/core/planning-v3/__tests__/tiny-problems"

import { POST, maxDuration, runtime } from "@/app/api/planning/v3/solve/route"
import { PLANNING_V3_ENDPOINT_VERSION } from "@/features/planning/v3"

/**
 * The route handler, called directly.
 *
 * Next.js resolves `app/api/planning/v3/solve/route.ts` to a URL; nothing in
 * this file can prove that mapping, and nothing needs to — a 404 is a
 * REGISTRATION problem (a stale dev server, a build that predates the file),
 * never a defect in the handler. What these tests establish is the other half:
 * that once the request reaches it, the handler behaves.
 *
 * Written after the endpoint answered 404 in a running dev server, precisely so
 * the two failure modes stop being confusable.
 */

const problem = tinyProblem()

function post(body: unknown, headers: Record<string, string> = {}): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body)
  return new Request("http://localhost/api/planning/v3/solve", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  })
}

describe("route V3 — configuration du segment", () => {
  it("s'exécute sur le runtime Node, seul capable de lancer un sous-processus", () => {
    expect(runtime).toBe("nodejs")
  })

  it("déclare un budget de temps compatible avec une résolution longue", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(60)
  })

  it("exporte bien un gestionnaire POST", () => {
    // The export Next.js looks for. Its absence is one of the two ways to get a
    // 404 from a file that exists.
    expect(typeof POST).toBe("function")
  })
})

describe("route V3 — refus, sans jamais lancer Python", () => {
  it("refuse un corps illisible", async () => {
    const response = await POST(post("<html>pas du json</html>"))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "body-not-json" })
  })

  it("refuse une version de frontière différente", async () => {
    const response = await POST(post({ endpointVersion: "planning-v3-solve/0", problem }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "endpoint-version-mismatch" })
  })

  it("refuse une requête sans problème", async () => {
    const response = await POST(post({ endpointVersion: PLANNING_V3_ENDPOINT_VERSION }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "problem-missing" })
  })

  it("refuse une charge annoncée trop grosse sans même la lire", async () => {
    const response = await POST(
      post({ endpointVersion: PLANNING_V3_ENDPOINT_VERSION, problem }, { "content-length": "99999999" })
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: "payload-too-large" })
  })

  it("refuse un délai hors bornes", async () => {
    const response = await POST(
      post({ endpointVersion: PLANNING_V3_ENDPOINT_VERSION, problem, timeoutSeconds: 100_000 })
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "timeout-out-of-range" })
  })

  it("répond toujours en JSON, jamais en HTML", async () => {
    // The symptom that started this: an HTML 404 page reaching a client that
    // expected a contract response. Every refusal below is machine-readable.
    for (const body of ["pas du json", { endpointVersion: "x" }, { endpointVersion: PLANNING_V3_ENDPOINT_VERSION }]) {
      const response = await POST(post(body))
      expect(response.headers.get("content-type")).toContain("application/json")
      const payload = (await response.json()) as { code?: string }
      expect(typeof payload.code).toBe("string")
    }
  })

  it("ne rend jamais une infaisabilité pour un refus de frontière", async () => {
    const response = await POST(post({ endpointVersion: "mauvaise" }))
    expect(JSON.stringify(await response.json())).not.toContain("infeasible")
  })
})
