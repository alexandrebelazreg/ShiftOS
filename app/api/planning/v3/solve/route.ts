import { currentSession } from "@/features/auth/dal"
import { createHighsFastAdapter } from "@/features/core/planning-contract/adapters/highs-fast"
import { buildSolvePlanningRequest } from "@/features/core/planning-contract/build-request"
import { checkSolvePlanningResponse } from "@/features/core/planning-contract/invariants"
import type { PlanningSolveAdapter } from "@/features/core/planning-contract/types/solve-response"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

import {
  parsePlanningV3Request,
  PLANNING_V3_MAX_PAYLOAD_BYTES,
} from "@/features/planning/v3/solve-endpoint-contract"

/**
 * The server boundary for the experimental V3 engine.
 *
 * This file is the ONLY place in the application that can reach CP-SAT. The
 * adapter spawns a Python subprocess through `node:child_process`, which cannot
 * exist in a browser bundle — so the frontier is not a style choice, it is what
 * makes the engine usable at all from a Next.js app whose generation has always
 * run client-side.
 *
 * A route handler rather than a server action: the payload is a serialised
 * problem, the reply is a serialised response, and both are plain JSON with no
 * React involvement. A server action would have coupled a solver run to a form
 * submission and a revalidation cycle it has no use for.
 *
 * No Python HTTP service, no FastAPI, no daemon. The subprocess boundary the
 * previous sprint built is still the whole transport; this route only decides
 * who may cross it and with what.
 *
 * Every failure here answers with the contract's own vocabulary, and NONE of
 * them can produce `infeasible`. A refused request, a missing interpreter and a
 * crashed model all say the same thing about the week: nothing.
 */

// The adapter spawns a process and reads the filesystem. Explicit rather than
// relying on the default, because the day this file is deployed to an edge
// runtime it must fail at build time, not at the first manager who clicks.
export const runtime = "nodejs"

// One request may legitimately occupy the solver for minutes. Declared so a
// platform that enforces a shorter default does not sever the pipe mid-search
// and turn a working run into a transport failure.
export const maxDuration = 300

export async function POST(request: Request): Promise<Response> {
  // La session, avant tout le reste — avant même de lire le corps.
  //
  // Le proxy redirige déjà un anonyme vers la connexion, mais Next 16 dit
  // explicitement de ne pas s'y fier pour l'autorisation. Et une redirection
  // n'est pas une réponse d'API : un appelant la suivrait et recevrait du HTML
  // là où il attend un verdict.
  //
  // Ce qui se joue ici n'est pas la confidentialité d'un planning : c'est qu'un
  // inconnu pouvait lancer un calcul de cinq minutes, autant de fois qu'il le
  // voulait, sur une machine à deux cœurs.
  //
  // `currentSession` et non `verifySession` : le second redirige, et une route
  // qui répond du JSON doit refuser en JSON.
  const session = await currentSession()
  if (!session) {
    return Response.json({ code: "unauthenticated", message: "Session requise." }, { status: 401 })
  }

  // Read the body as TEXT first: the size limit protects memory, and it can
  // only do that before `JSON.parse` turns megabytes of text into objects.
  const declared = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > PLANNING_V3_MAX_PAYLOAD_BYTES) {
    return refuse("payload-too-large", `Charge annoncée de ${declared} octets.`, 413)
  }

  let raw: string
  try {
    raw = await request.text()
  } catch (error) {
    return refuse(
      "body-unreadable",
      error instanceof Error ? error.message : "Corps illisible.",
      400
    )
  }

  const parsed = parsePlanningV3Request(raw)
  if (!parsed.ok) {
    return refuse(parsed.code, parsed.message, parsed.code === "payload-too-large" ? 413 : 400)
  }

  // Opt-in capture of the REAL problem, for diagnosing a real week.
  //
  // Every engine measurement so far has been taken on hand-built fixtures. They
  // are faithful to the rules and say nothing about the shapes a live roster
  // actually produces — part-time contracts, a day closed mid-week, a period
  // spanning two weeks. When a manager reports a result the fixtures never
  // predicted, the only way to explain it is to solve THEIR week, and the only
  // way to solve it is to have it.
  //
  // Off unless `PLANNING_V3_DUMP_DIR` is set, and never on by default: a
  // planning problem carries names, contracts and availabilities, so writing it
  // to disk is a deliberate act, not a side effect of clicking Générer.
  await dumpProblem(parsed.body.problem)

  const solveRequest = buildSolvePlanningRequest(
    parsed.body.problem,
    parsed.body.regeneration ?? null,
    parsed.body.baseline ?? null
  )

  // The client's abort propagates all the way to the subprocess: the adapter
  // polls this flag and kills Python rather than leaving an orphan solving a
  // week nobody is waiting for.
  const cancellation = { aborted: false }
  const onAbort = (): void => {
    cancellation.aborted = true
  }
  request.signal.addEventListener("abort", onAbort)

  // `profile` and `engine` are still ACCEPTED and validated by the contract —
  // a caller naming the engine it wants must be told when that name is wrong —
  // but neither is read here any more: there is one engine, and it takes its
  // budget from `timeoutSeconds`.
  // The ONE place an engine is chosen. There is exactly one today, and it is
  // still resolved through `PlanningSolveAdapter` rather than called directly:
  // nothing below this line — including the invariant check and the
  // serialisation — may be able to tell which engine answered, because that is
  // the property that let three engines share this route and the property a
  // fourth would arrive through.
  //
  // There is no fallback. A run that fails is reported as that engine failing,
  // never quietly re-run on another: a caller who asked for one engine and
  // silently received another has no way to interpret the answer.
  const timeoutSeconds = parsed.body.timeoutSeconds
  const adapter: PlanningSolveAdapter = createHighsFastAdapter({
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    signal: cancellation,
  })

  let response: SolvePlanningResponse
  try {
    response = await adapter(solveRequest)
  } catch (error) {
    // The adapter throws only on a defect of its own — a response that breaks
    // the contract. Reported as a backend failure, never as a verdict.
    return refuse(
      "engine-defect",
      error instanceof Error ? error.message : String(error),
      500
    )
  } finally {
    request.signal.removeEventListener("abort", onAbort)
  }

  // Checked once more before it leaves the process. The adapter already asserts
  // its own output; this is the boundary asserting that what it is about to put
  // on the wire is still conformant after serialisation crosses it.
  const violations = checkSolvePlanningResponse(response)
  if (violations.length > 0) {
    return refuse(
      "engine-defect",
      `Réponse non conforme au contrat : ${violations.map((entry) => entry.code).join(", ")}.`,
      500
    )
  }

  return Response.json(response, { status: 200 })
}

/**
 * A refusal, shaped so no client can mistake it for an answer.
 *
 * Deliberately NOT a `SolvePlanningResponse`: a refused request never reached
 * an engine, so dressing it as an engine outcome would invite a caller to read
 * `outcome` and act on it. The client turns this into a `backend-error`
 * response itself, which is the one honest translation.
 */
/**
 * Write the incoming problem where an engineer can replay it.
 *
 * Named by fingerprint, so two clicks on the same week overwrite one file
 * instead of filling a directory, and two clicks on DIFFERENT weeks never
 * collide — which is precisely what the fingerprint is for.
 *
 * Failure here is swallowed on purpose. A full disk or a bad path must not turn
 * a working generation into an error: this is an aid to diagnosis, and an aid
 * that can break the thing it observes is worse than no aid.
 */
async function dumpProblem(problem: unknown): Promise<void> {
  const directory = process.env.PLANNING_V3_DUMP_DIR
  if (directory === undefined || directory.trim().length === 0) return
  try {
    const { mkdir, writeFile } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const { fingerprintProblem } = await import("@/features/core/planning-v3/validator")
    await mkdir(directory, { recursive: true })
    const name = `${fingerprintProblem(problem as never)}-problem.json`
    await writeFile(join(directory, name), JSON.stringify(problem, null, 2) + "\n", "utf8")
  } catch {
    // Deliberately silent. See above.
  }
}

function refuse(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status })
}
