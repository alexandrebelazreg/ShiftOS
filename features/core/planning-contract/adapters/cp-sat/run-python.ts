import { spawn } from "node:child_process"
import { join } from "node:path"

/**
 * The process boundary. The ONLY file in the contract that touches the OS.
 *
 * Isolated to one small module for two reasons. It is the only part that cannot
 * be unit tested without an installed Python, so everything else is written to
 * be testable without it — `CpSatRunner` is an injectable function, and every
 * failure mode below has a fake in the test suite. And it is the reason the
 * CP-SAT adapter is server-side only: `node:child_process` cannot be bundled
 * for a browser, which is why nothing here is re-exported from the adapters
 * barrel.
 *
 * A subprocess rather than a service: no port, no framework, no daemon to keep
 * alive. It is the smallest thing that is still a real process boundary, which
 * is exactly what an experimental sprint should be paying for.
 */

export type CpSatTransportCode =
  | "python-not-found"
  | "process-timeout"
  | "process-crashed"
  | "process-killed"

export type CpSatRunOutcome =
  | { readonly kind: "stdout"; readonly stdout: string }
  | { readonly kind: "cancelled" }
  | {
      readonly kind: "failure"
      readonly code: CpSatTransportCode
      readonly message: string
    }

export interface CpSatRunOptions {
  /** Hard wall-clock kill, always longer than the solver's own budget. */
  readonly timeoutMs: number
  readonly signal?: { readonly aborted: boolean }
}

export type CpSatRunner = (payload: string, options: CpSatRunOptions) => Promise<CpSatRunOutcome>

export interface PythonRunnerConfig {
  readonly pythonExecutable?: string
  readonly scriptPath?: string
  /** How often to poll the cancellation flag. */
  readonly pollMs?: number
}

/** The experimental script, resolved from the repository root. */
export function defaultCpSatScriptPath(): string {
  return join(process.cwd(), "experiments", "planning-v3-cpsat", "cpsat_service.py")
}

export function createPythonRunner(config: PythonRunnerConfig = {}): CpSatRunner {
  const executable = config.pythonExecutable ?? process.env.PLANNING_CPSAT_PYTHON ?? "python"
  const script = config.scriptPath ?? defaultCpSatScriptPath()
  const pollMs = config.pollMs ?? 100

  return (payload, options) =>
    new Promise<CpSatRunOutcome>((resolve) => {
      let settled = false
      const finish = (outcome: CpSatRunOutcome): void => {
        if (settled) return
        settled = true
        clearInterval(poller)
        clearTimeout(killer)
        resolve(outcome)
      }

      const child = spawn(executable, [script], {
        cwd: join(process.cwd(), "experiments", "planning-v3-cpsat"),
        stdio: ["pipe", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8")
      })
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8")
      })

      // ENOENT here means the interpreter itself is missing. Reported as its
      // own code so a caller can tell "install Python" from "the model broke".
      child.on("error", (error: NodeJS.ErrnoException) => {
        finish({
          kind: "failure",
          code: error.code === "ENOENT" ? "python-not-found" : "process-crashed",
          message: `${error.code ?? "ERR"} — ${error.message}`,
        })
      })

      child.on("close", (code, signal) => {
        if (signal !== null) {
          finish({
            kind: "failure",
            code: "process-killed",
            message: `Processus interrompu par le signal ${signal}.`,
          })
          return
        }
        if (code !== 0) {
          finish({
            kind: "failure",
            code: "process-crashed",
            message: `Code de sortie ${code}. ${stderr.trim().slice(0, 500)}`,
          })
          return
        }
        finish({ kind: "stdout", stdout })
      })

      const killer = setTimeout(() => {
        child.kill("SIGKILL")
        finish({
          kind: "failure",
          code: "process-timeout",
          message: `Aucune réponse en ${options.timeoutMs} ms ; processus tué.`,
        })
      }, options.timeoutMs)

      const poller = setInterval(() => {
        if (options.signal?.aborted === true) {
          child.kill("SIGKILL")
          finish({ kind: "cancelled" })
        }
      }, pollMs)

      child.stdin.on("error", () => {
        /* The close handler already reports a process that died mid-write. */
      })
      child.stdin.end(payload, "utf8")
    })
}
