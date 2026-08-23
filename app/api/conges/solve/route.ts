import { currentSession } from "@/features/auth/dal"
import { createPythonRunner } from "@/features/core/planning-contract/adapters/python/run-python"
import { resolveHighsFastPython } from "@/features/core/planning-contract/adapters/python/run-python"
import {
  paidLeaveSolveRequestSchema,
  paidLeaveSolveResponseSchema,
} from "@/features/paid-leave/solver/paid-leave-solver-contract"

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
  const parsed = paidLeaveSolveRequestSchema.safeParse(value)
  if (!parsed.success) {
    return Response.json({ message: "Les données de la campagne sont invalides." }, { status: 400 })
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
    const outcome = await runner(JSON.stringify(parsed.data), {
      timeoutMs: (parsed.data.timeoutSeconds + 10) * 1000,
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
