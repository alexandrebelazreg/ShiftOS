import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * The process boundary. The ONLY file in the contract that touches the OS.
 *
 * Isolated to one small module for two reasons. It is the only part that cannot
 * be unit tested without an installed Python, so everything else is written to
 * be testable without it — the runner is an injectable function, and every
 * failure mode below has a fake in the test suite. And it is the reason the
 * engine adapter is server-side only: `node:child_process` cannot be bundled
 * for a browser, which is why nothing here is re-exported from the adapters
 * barrel.
 *
 * It used to live inside the CP-SAT adapter and moved here when that engine was
 * deleted: the transport was never CP-SAT's, it is what ANY Python engine needs,
 * and leaving it under a deleted engine's folder is how a shared dependency
 * disappears with something it never belonged to.
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
  /**
   * Where the process starts, which decides what it can import.
   *
   * Each experiment is a Python package rooted in its own folder, so a script
   * launched from the repository root would fail on its first import for a
   * reason that looks nothing like the real one. Defaults to the CP-SAT folder
   * because that was the only caller; a second engine passes its own.
   */
  readonly cwd?: string
  /** How often to poll the cancellation flag. */
  readonly pollMs?: number
}

/** The experimental script, resolved from the repository root. */
export function defaultCpSatScriptPath(): string {
  return join(process.cwd(), "experiments", "planning-v3-cpsat", "cpsat_service.py")
}

/**
 * Which Python runs the HiGHS engine, and why it is not CP-SAT's.
 *
 * The two experiments have INCOMPATIBLE dependency sets — OR-Tools on one side,
 * scipy and HiGHS on the other — and each lives in its own virtual environment.
 * One shared interpreter setting means whichever engine the machine was last
 * prepared for works and the other reports a missing module. That is not a
 * hypothesis: the first wiring of the HiGHS adapter inherited CP-SAT's default,
 * spawned the interpreter on `PATH`, and surfaced
 * `highs-missing — No module named 'scipy'` in the planning screen.
 *
 * It lives HERE rather than beside the adapter because it reads the filesystem,
 * and this file is the one place in the contract allowed to touch the OS — the
 * boundary an architecture test enforces. Resolving an interpreter is a
 * question about the machine, so it belongs on the machine's side of that line.
 *
 * The order is deliberate. An explicit variable wins: an operator who names an
 * interpreter has a reason. The repository's own environment comes next,
 * because on a developer machine it is both present and correct, and requiring
 * an exported variable to run one's own project is friction for nothing. Bare
 * `python` is the last resort — and when nothing is installed it produces the
 * clear failure above, which is the right outcome. An engine that cannot run
 * must say so, never quietly hand the question to another engine.
 */
export function resolveHighsFastPython(): string {
  const declared = process.env.PLANNING_HIGHS_PYTHON
  if (declared !== undefined && declared.trim().length > 0) return declared

  const root = process.cwd()
  const candidates =
    process.platform === "win32"
      ? [join(root, ".venv-planning-highs", "Scripts", "python.exe")]
      : [
          join(root, ".venv-planning-highs", "bin", "python3"),
          join(root, ".venv-planning-highs", "bin", "python"),
        ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return "python"
}

export function createPythonRunner(config: PythonRunnerConfig = {}): CpSatRunner {
  const executable = config.pythonExecutable ?? process.env.PLANNING_CPSAT_PYTHON ?? "python"
  const script = config.scriptPath ?? defaultCpSatScriptPath()
  const cwd = config.cwd ?? join(process.cwd(), "experiments", "planning-v3-cpsat")
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
        cwd,
        // Sets and dictionaries participate in the fast engine's candidate
        // enumeration.  A random per-process hash seed made the canonical
        // Drive alternate between a sub-second 0/0 answer and a search lasting
        // tens of seconds.  Fixing it makes the historical result and latency
        // reproducible without changing the mathematical problem.
        env: { ...process.env, PYTHONHASHSEED: "0" },
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
