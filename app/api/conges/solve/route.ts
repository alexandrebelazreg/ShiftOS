import { z } from "zod"

import { currentSession } from "@/features/auth/dal"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { createPythonRunner } from "@/features/core/planning-contract/adapters/python/run-python"
import { resolveHighsFastPython } from "@/features/core/planning-contract/adapters/python/run-python"
import { loadPaidLeaveSolveRequest } from "@/features/paid-leave/solver/load-solve-request"
import {
  paidLeaveSolveRequestSchema,
  paidLeaveSolveResponseSchema,
} from "@/features/paid-leave/solver/paid-leave-solver-contract"

/**
 * Ce que le navigateur a le droit de dire : QUELLE campagne, et pendant combien
 * de temps chercher.
 *
 * `request` est le repli des installations sans base — celles qui rangent tout
 * dans le `localStorage` du navigateur, où le serveur n'a par construction rien
 * à relire. Il n'est accepté que dans ce mode, et le mode se lit dans la
 * configuration DU SERVEUR : aucun champ de la requête ne peut le déclencher.
 * C'est toute la différence entre un repli et une porte dérobée.
 */
const solveBodySchema = z.object({
  campaignId: z.string().min(1),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
  request: paidLeaveSolveRequestSchema.optional(),
})

export const runtime = "nodejs"
export const maxDuration = 300

const MAX_PAYLOAD_BYTES = 2_000_000

export async function POST(request: Request): Promise<Response> {
  // Même garde que la route de planning, et pour la même raison : sans elle,
  // un inconnu déclenche un solveur de plusieurs minutes à volonté. Refuse en
  // JSON, parce qu'une redirection vers la connexion n'est pas une réponse
  // qu'un appelant d'API sait lire.
  const session = await currentSession()
  if (!session) {
    return Response.json({ message: "Session requise." }, { status: 401 })
  }

  const declared = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
    return Response.json({ message: "La campagne est trop volumineuse." }, { status: 413 })
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return Response.json({ message: "La demande est illisible." }, { status: 400 })
  }
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return Response.json({ message: "La campagne est trop volumineuse." }, { status: 413 })
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return Response.json({ message: "Le contenu JSON est invalide." }, { status: 400 })
  }
  const body = solveBodySchema.safeParse(value)
  if (!body.success) {
    return Response.json({ message: "Les données de la campagne sont invalides." }, { status: 400 })
  }

  // LA DEMANDE SE RELIT EN BASE, elle ne se reçoit pas. Les minimums de
  // couverture, les plafonds d'effectif, les soldes et les cibles venaient
  // jusqu'ici du navigateur, et le schéma n'en vérifiait que la forme : une
  // requête forgée à la main désactivait toutes les règles du produit.
  let solveRequest
  if (supabaseConfigured()) {
    solveRequest = await loadPaidLeaveSolveRequest(body.data.campaignId, body.data.timeoutSeconds)
    if (!solveRequest) {
      // Introuvable ET interdite rendent le même 404 : les distinguer dirait à
      // un curieux si un identifiant est utilisé dans un autre magasin.
      return Response.json({ message: "Campagne introuvable." }, { status: 404 })
    }
  } else {
    if (!body.data.request) {
      return Response.json({ message: "Les données de la campagne sont invalides." }, { status: 400 })
    }
    solveRequest = { ...body.data.request, timeoutSeconds: body.data.timeoutSeconds }
  }

  const controller = { aborted: false }
  const abort = () => {
    controller.aborted = true
  }
  request.signal.addEventListener("abort", abort)
  const runner = createPythonRunner({
    pythonExecutable: resolveHighsFastPython(),
    scriptPath: `${process.cwd()}/experiments/paid-leave-solver/paid_leave_solver.py`,
    cwd: `${process.cwd()}/experiments/paid-leave-solver`,
  })

  try {
    const outcome = await runner(JSON.stringify(solveRequest), {
      // Le temps du CORPS validé, et non celui de la charge utile. Les deux sont
      // égaux par construction — la demande est bâtie avec — mais la minuterie qui
      // tue le sous-processus décide combien de temps un appelant peut occuper le
      // serveur : la lire ailleurs que dans le champ borné par le schéma, c'est
      // la rendre réglable par autre chose que lui.
      timeoutMs: (body.data.timeoutSeconds + 10) * 1000,
      signal: controller,
    })
    if (outcome.kind === "cancelled") {
      return Response.json({ message: "Calcul annulé." }, { status: 499 })
    }
    if (outcome.kind === "failure") {
      return Response.json({ message: outcome.message }, { status: 503 })
    }
    let responseValue: unknown
    try {
      responseValue = JSON.parse(outcome.stdout)
    } catch {
      return Response.json({ message: "Le solveur a renvoyé une réponse illisible." }, { status: 502 })
    }
    const response = paidLeaveSolveResponseSchema.safeParse(responseValue)
    if (!response.success) {
      return Response.json({ message: "Le solveur a renvoyé une réponse non conforme." }, { status: 502 })
    }
    return Response.json(response.data)
  } finally {
    request.signal.removeEventListener("abort", abort)
  }
}
