import {
  createPythonRunner,
  resolveHighsFastPython,
} from "@/features/core/planning-contract/adapters/python/run-python"
import type { CpSatRunner } from "@/features/core/planning-contract/adapters/python/run-python"
import type { EnginePreservationSupport } from "@/features/core/planning-contract/adapters/from-audited-v3"
import { toSolvePlanningResponse } from "@/features/core/planning-contract/adapters/from-audited-v3"
import { applyLocks } from "@/features/core/planning-contract/locks"
import type { LockApplication } from "@/features/core/planning-contract/locks"
import { toBackendErrorResponse } from "@/features/core/planning-contract/errors"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type {
  PlanningSolveAdapter,
  SolveDiagnostic,
  SolvePlanningResponse,
  SolveTechnicalFact,
} from "@/features/core/planning-contract/types/solve-response"
import type { AuditedSolutionV3 } from "@/features/core/planning-v3/types/audited-solution"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type {
  PlanningSolverResultV3,
  PlanningSolverStatusV3,
} from "@/features/core/planning-v3/types/solver"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"
import { rebalanceClosings } from "@/features/core/planning-v3/rebalance-closings"
import { planClosingQuotas, type ClosingQuotaPlan } from "@/features/core/planning-v3/fairness/closing-quota"
import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"

import {
  HIGHS_FAST_PROTOCOL_VERSION,
  parseHighsFastResponse,
} from "@/features/core/planning-contract/adapters/highs-fast/protocol"
import type {
  HighsFastRequestEnvelope,
  HighsFastResponseEnvelope,
} from "@/features/core/planning-contract/adapters/highs-fast/protocol"

/**
 * `v3-highs-fast`, behind the neutral contract.
 *
 * A decomposed MILP engine: it settles the weekly roles first, then asks one
 * small allocation model per skeleton, then places exactly. On the canonical
 * Drive week it reaches zero shortfall in about twelve seconds, where the
 * global HiGHS engine needs more than two hundred — and a fifty-nine scenario
 * perturbation campaign found no illegal schedule and no false impossibility.
 *
 * It reaches Python the same way CP-SAT does, through the subprocess runner
 * that already exists. The runner is reused rather than copied: it knows how to
 * kill a hung process, how to distinguish a missing interpreter from a crash,
 * and how to propagate an abort — three things worth getting right once.
 *
 * What it cannot do
 * -----------------
 * It solves from scratch every time. It cannot pin a shift, cannot keep a
 * manual move, and does not optimise for stability against a previous
 * schedule. `HIGHS_FAST_PRESERVATION_SUPPORT` states that plainly, and the
 * mapper turns it into unmet preservations a manager can see rather than a
 * silent unlock — a schedule that ignores a lock is not a worse answer, it is
 * an answer to a different question.
 *
 * And it never claims a proof about a SCHEDULE. Two heuristic choices — which
 * skeletons to rank, which allocation each one gets — sit upstream of the only
 * exact step, so `proof.kind` is `"feasible"` at best and this adapter never
 * upgrades it. An impossibility is the opposite case and is reported as such,
 * because the demand model and the allocation MILP each prove theirs outright.
 */
export const HIGHS_FAST_PRESERVATION_SUPPORT: EnginePreservationSupport = {
  // Les verrous sont désormais tenus — non par une règle ajoutée au solveur,
  // mais en TRADUISANT chaque créneau verrouillé en heures imposées sur la
  // journée concernée. Le moteur honore ce mécanisme depuis toujours ; il n'a
  // pas eu à changer, donc il n'a pas eu à être re-prouvé.
  //
  // Un verrou qu'on ne peut pas tenir exactement — créneau coupé, journée
  // absente du problème, horaire déjà imposé par la fiche — n'est pas approché
  // en silence : il est refusé, dit, et la capacité retombe à faux pour CETTE
  // demande. Voir `applyLocks`.
  locks: true,
  manualEdits: false,
  minimizeOtherChanges: false,
}

/** Matches the ceiling `highs_service.py` clamps to on the other side. */
export const HIGHS_FAST_MAX_TIMEOUT_SECONDS = 90

/** The everyday budget. Measured worst case across the campaign: 62 seconds. */
export const HIGHS_FAST_DEFAULT_TIMEOUT_SECONDS = 60

export interface HighsFastAdapterConfig {
  /** Injected for tests: every failure mode has a fake, none needs Python. */
  readonly runner?: CpSatRunner
  readonly pythonExecutable?: string
  readonly scriptPath?: string
  readonly timeoutSeconds?: number
  /**
   * Hard kill for the process, beyond the solver's own budget.
   *
   * Strictly larger on purpose: a process killed at exactly its solver budget
   * would report a transport failure for what is really a clean timeout, and
   * the two must not be confused — one is an outage, the other is a fact about
   * the search.
   */
  readonly processTimeoutMs?: number
  readonly signal?: { readonly aborted: boolean }
}

/** The experimental script, resolved from the repository root. */
export function defaultHighsFastScriptPath(): string {
  // Built with the same join the CP-SAT runner uses, and kept here rather than
  // imported so the two engines can move independently.
  return ["experiments", "planning-v3-highs", "highs_service.py"].join("/")
}


export function createHighsFastAdapter(
  config: HighsFastAdapterConfig = {}
): PlanningSolveAdapter {
  const timeoutSeconds = Math.min(
    config.timeoutSeconds ?? HIGHS_FAST_DEFAULT_TIMEOUT_SECONDS,
    HIGHS_FAST_MAX_TIMEOUT_SECONDS
  )
  // The Python pipeline checks its own solve deadline. The outer timeout is
  // only a hung-process fuse, so it must leave room for Windows process start,
  // scipy imports and final JSON serialisation. A five-second margin killed a
  // healthy 58.7-second solve at 65 seconds before its answer crossed stdout.
  // This does NOT enlarge the solver's search budget: it remains 60 seconds.
  const processTimeoutMs = config.processTimeoutMs ?? Math.round(timeoutSeconds * 1000) + 15_000
  const runner =
    config.runner ??
    createPythonRunner({
      pythonExecutable: config.pythonExecutable ?? resolveHighsFastPython(),
      scriptPath: config.scriptPath ?? resolveScriptPath(),
      cwd: resolveWorkingDirectory(),
    })

  return async (request: SolvePlanningRequest): Promise<SolvePlanningResponse> => {
    if (config.signal?.aborted === true) {
      return failure(request, "engine-cancelled", "Résolution annulée avant le lancement.")
    }

    // Les verrous sont traduits AVANT tout le reste, et le problème épinglé
    // remplace l'original pour la suite : envoi, empreinte, et surtout
    // validation. Valider contre le problème d'origine laisserait passer un
    // moteur qui aurait ignoré un verrou — c'est justement ce qu'on veut
    // rendre impossible.
    const locks = applyLocks(request.problem, request.regeneration, request.baseline)
    const effective: SolvePlanningRequest = { ...request, problem: locks.problem }

    // L'ÉQUITÉ, POSÉE COMME CONTRAINTE plutôt que confiée à une préférence.
    //
    // Une préférence classée sous la couverture ne décide de rien une fois les
    // heures contractuelles placées, et corriger après coup s'est révélé
    // impossible : sur une semaine réelle, chaque échange butait sur une borne
    // horaire personnelle ou le repos de douze heures. Le plafond de fermetures,
    // lui, est DUR et respecté pendant le placement — au seul moment où « qui
    // ferme » se décide. On le resserre donc pour ceux qui ont le plus fermé.
    const quota = planClosingQuotas(effective.problem)

    const runFor = async (problem: PlanningProblemV3) => {
      const envelope: HighsFastRequestEnvelope = {
        protocolVersion: HIGHS_FAST_PROTOCOL_VERSION,
        // L'empreinte reste celle du problème RÉELLEMENT demandé : les quotas
        // sont un resserrement interne, pas une autre question posée.
        requestId: fingerprintProblem(effective.problem),
        problem,
        options: { timeoutSeconds },
      }
      return runner(JSON.stringify(envelope), {
        timeoutMs: processTimeoutMs,
        signal: config.signal,
      })
    }

    let outcome
    let fallbackReason: string | null = null
    try {
      outcome = await runFor(quota.problem)

      // Le repli, sans lequel l'équité pourrait coûter une semaine entière : un
      // JOUR dont tous les fermeurs possibles sont à leur quota n'a plus de
      // solution. Le calcul ne peut pas l'écarter d'avance — il raisonne sur la
      // semaine, pas sur chaque journée. On refait alors sans quota, et c'est
      // cette réponse-là qui compte.
      const refusal = quota.applied ? whyNotSolved(outcome) : null
      if (refusal !== null) {
        fallbackReason = refusal
        outcome = await runFor(effective.problem)
      }
    } catch (error) {
      // A runner that throws is still a transport failure, never a verdict.
      return failure(
        request,
        "engine-transport-failure",
        error instanceof Error ? error.message : String(error)
      )
    }

    if (outcome.kind === "cancelled") {
      return failure(request, "engine-cancelled", "Résolution annulée.")
    }
    if (outcome.kind === "failure") {
      // Every transport failure reports under the SAME diagnostic code. The
      // specific cause travels in the message: no caller should branch
      // differently on "Python is missing" than on "the pipe broke" — both mean
      // the same thing to a manager.
      return failure(request, "engine-transport-failure", `${outcome.code} — ${outcome.message}`)
    }

    const parsed = parseHighsFastResponse(outcome.stdout)
    if (!parsed.ok) {
      return failure(request, "engine-transport-failure", `${parsed.code} — ${parsed.message}`)
    }

    return fromEnvelope(effective, parsed.envelope, locks, quota, fallbackReason)
  }
}

/**
 * Ce que la tentative avec quota a réellement rendu, ou `null` si elle a abouti.
 *
 * Le repli annonçait « aucun planning légal ne respectait ces plafonds ». C'est
 * une CONCLUSION, et elle était fausse une fois sur deux : le moteur peut aussi
 * n'avoir pas eu le temps, ce qui appelle un budget plus long et non un plafond
 * plus lâche. Dire le statut brut plutôt que l'interpréter.
 */
function whyNotSolved(outcome: {
  readonly kind: string
  readonly stdout?: string
}): string | null {
  if (outcome.kind === "cancelled") return "la résolution a été annulée"
  if (outcome.kind !== "success" || outcome.stdout === undefined) {
    return "le moteur n'a rien rendu de lisible"
  }
  const parsed = parseHighsFastResponse(outcome.stdout)
  if (!parsed.ok) return "la réponse du moteur était illisible"
  if (parsed.envelope.status === "solved") return null
  if (parsed.envelope.status === "infeasible") {
    return "aucun planning légal ne les respectait — un jour au moins n'avait plus de fermeur disponible"
  }
  if (parsed.envelope.status === "no-solution") {
    // Le protocole est net là-dessus : `no-solution` veut dire que le moteur a
    // épuisé un VOISINAGE HEURISTIQUE, et ne prouve rien sur la semaine. Seul
    // `infeasible` affirme l'impossibilité. Confondre les deux enverrait
    // desserrer un plafond alors qu'il faudrait allonger le temps de calcul.
    return "le moteur n'en a pas trouvé dans le temps imparti — ce qui ne prouve pas qu'il n'en existe pas ; la semaine est déjà à la limite de ce qu'il sait résoudre"
  }
  return `le moteur a répondu « ${parsed.envelope.status} »`
}

function fromEnvelope(
  request: SolvePlanningRequest,
  envelope: HighsFastResponseEnvelope,
  locks: LockApplication,
  quota: ClosingQuotaPlan,
  fallbackReason: string | null
): SolvePlanningResponse {
  if (envelope.status === "error") {
    return failure(
      request,
      "engine-transport-failure",
      `${envelope.error?.code ?? "unknown"} — ${envelope.error?.message ?? ""}`
    )
  }

  const audited = auditEnvelope(request, envelope)

  // La capacité déclarée vaut pour le moteur ; celle-ci vaut pour CETTE demande.
  // Un verrou refusé — créneau coupé, journée absente, horaire déjà imposé par
  // la fiche — doit faire retomber la promesse à faux, sinon l'écran annoncerait
  // « verrous tenus » alors qu'un l'a été et l'autre pas.
  const support: EnginePreservationSupport = {
    ...HIGHS_FAST_PRESERVATION_SUPPORT,
    locks: HIGHS_FAST_PRESERVATION_SUPPORT.locks && locks.refused.length === 0,
  }

  const response = toSolvePlanningResponse("highs-fast", request, audited, support)

  // Chaque refus est NOMMÉ, avec sa raison. « Les verrous n'ont pas été tenus »
  // ne dit pas lequel, et le gérant ne saurait pas quoi corriger.
  const refusals: SolveDiagnostic[] = locks.refused.map((refusal) => ({
    code: "lock-refused",
    severity: "degradation",
    message: `Un créneau verrouillé n'a pas pu être figé : ${refusal.reason}.`,
    requiresExplicitAcceptance: false,
  }))

  // Le plafond d'équité, dit à voix haute. Sans cela il agit en silence, et un
  // gérant qui ne voit pas le résultat espéré ne peut pas distinguer un quota
  // mal calculé d'un quota que la semaine n'a pas pu honorer — deux pannes qui
  // appellent des corrections opposées.
  const quotaFacts: SolveDiagnostic[] = []
  if (!quota.applied && quota.reason !== null) {
    // Le cas le plus important à dire. Un plafond qui ne s'applique pas laissait
    // le rapport entièrement muet, donc indiscernable d'un plafond appliqué sans
    // effet — deux pannes qui appellent des corrections contraires.
    quotaFacts.push({
      code: "closing-quota",
      severity: "information",
      message: `Aucun plafond d'équité posé cette semaine : ${quota.reason}.`,
      requiresExplicitAcceptance: false,
    })
  }
  if (quota.applied) {
    quotaFacts.push({
      code: "closing-quota",
      severity: "information",
      message:
        "Plafond d'équité de la semaine : " +
        quota.quotas
          .map((entry) => `${String(entry.employeeId)} ${entry.allowed}`)
          .join(", ") +
        ".",
      requiresExplicitAcceptance: false,
    })
    if (fallbackReason !== null) {
      quotaFacts.push({
        code: "closing-quota",
        severity: "information",
        message: `Ces plafonds n'ont PAS été appliqués : ${fallbackReason}. La semaine a été générée avec les plafonds ordinaires.`,
        requiresExplicitAcceptance: false,
      })
    }
  }

  return {
    ...response,
    diagnostics: {
      ...response.diagnostics,
      entries: [...response.diagnostics.entries, ...refusals, ...quotaFacts],
      technical: [
        ...response.diagnostics.technical,
        ...technicalFacts(envelope),
        {
          label: "Créneaux verrouillés figés",
          value: `${locks.honoured.length} tenus, ${locks.refused.length} refusés`,
        },
      ],
    },
  }
}

/**
 * Re-check the Python answer with the TypeScript validator, always.
 *
 * A Python schedule is never accepted on its own word. `shiftos_highs.evaluate`
 * is a second implementation of the rules and a second implementation can be
 * wrong in the same way as the first, so the one authority on what "legal"
 * means in Planiteo gets the final say — and a disagreement surfaces as
 * `solverContradictedByValidator`, which the contract turns into a refusal
 * rather than into a schedule.
 */
function auditEnvelope(
  request: SolvePlanningRequest,
  envelope: HighsFastResponseEnvelope
): AuditedSolutionV3 {
  const status: PlanningSolverStatusV3 =
    envelope.status === "solved"
      ? "feasible-timeout"
      : envelope.status === "infeasible"
        ? "infeasible"
        : envelope.status === "invalid-problem"
          ? "invalid-problem"
          : "feasible-timeout"

  if (envelope.status !== "solved") {
    return {
      result: emptyResult(status, envelope),
      report: null,
      solverContradictedByValidator: false,
    }
  }

  const placed: PlanningSolutionV3 = {
    version: request.problem.version,
    problemFingerprint: fingerprintProblem(request.problem),
    assignments: envelope.assignments,
  }

  // Le moteur s'arrête là ; l'équité, elle, n'a presque plus de liberté une fois
  // les heures contractuelles posées. Ce dernier passage échange des journées de
  // MÊME DURÉE entre deux personnes, ce qui ne touche ni la couverture ni aucun
  // total hebdomadaire, et ne retient un échange que si le validateur le
  // confirme. Sans équité réglée, il ne fait rien du tout et rend la solution
  // reçue, à l'identique.
  const rebalanced = rebalanceClosings(request.problem, placed)
  const solution = rebalanced.solution
  const report = validatePlanningSolutionV3(request.problem, solution)

  return {
    result: {
      // NEVER `optimal`. The status is deliberately `feasible-timeout` even when
      // the engine stopped early with nothing missing: it stopped because it
      // reached zero, not because it exhausted anything, and the difference is
      // exactly what `optimal` would misstate.
      status: "feasible-timeout",
      solution,
      objective: [report.underCoveredSlots, report.metrics.totalDeficitMinutes],
      proof: {
        kind: "feasible",
        objectiveValues: [report.underCoveredSlots, report.metrics.totalDeficitMinutes],
        note: "Moteur décomposé : squelettes puis allocation conditionnée. Aucune optimalité démontrée.",
        candidateSpace: "incomplete",
        // The contract has four words for why a search ended, and neither of
        // this engine's two endings is `exhausted` — it never explores the whole
        // space, by construction.
        //
        // `state-limit` when it reached zero: it stopped on its OWN declared
        // rule, having walked a deliberately bounded set of skeletons and
        // allocations. Nothing is better than a legal week with nothing
        // missing, so it stops, and calling that a timeout would blame a clock
        // that had time left.
        //
        // `timeout` when it did not: the budget is what ended the search, and
        // a longer one might have found more.
        stopCause:
          envelope.diagnostics.engineStatus === "feasible-zero-deficit"
            ? "state-limit"
            : "timeout",
        // A wall-clock-limited MIP may stop on a different node between runs.
        // Stable ordering makes the walk reproducible when it completes, but a
        // timed incumbent must not be advertised as deterministic.
        deterministic: false,
        durationMs: Math.round((numberOf(envelope.diagnostics.totalSeconds) ?? 0) * 1000),
      },
      statistics: emptyStatistics(envelope),
      diagnostics: [],
    },
    report,
    solverContradictedByValidator: !report.validHardConstraints,
  }
}

function emptyResult(
  status: PlanningSolverStatusV3,
  envelope: HighsFastResponseEnvelope
): PlanningSolverResultV3 {
  return {
    status,
    solution: null,
    objective: null,
    proof: {
      kind: "none",
      objectiveValues: [],
      note:
        envelope.status === "infeasible"
          ? "Impossibilité démontrée : aucune allocation ne satisfait contrats et budgets, ou un plancher dur dépasse la capacité."
          : "Aucun planning trouvé dans le voisinage exploré. Ceci ne démontre rien sur la semaine.",
      candidateSpace: "incomplete",
      stopCause:
        envelope.status === "infeasible"
          ? "exhausted"
          : envelope.status === "invalid-problem"
            ? "not-started"
            : "timeout",
      deterministic: envelope.status === "infeasible",
    },
    statistics: emptyStatistics(envelope),
    diagnostics: diagnosticsOf(envelope),
  }
}

function diagnosticsOf(envelope: HighsFastResponseEnvelope) {
  const reason = envelope.diagnostics.reason
  if (typeof reason !== "string" || reason.length === 0) return []

  if (reason === "day-cannot-be-staffed") {
    const days = recordsOf(envelope.diagnostics.infeasibleDays)
    if (days.length === 0) {
      return [
        {
          code: reason,
          message:
            "Au moins une journée demande plus de travail ou de présence obligatoire que l'équipe disponible ne peut en fournir.",
        },
      ]
    }

    return days.map((day) => {
      const date = formatIsoDate(day.date)
      const dayReason = typeof day.reason === "string" ? day.reason : reason
      const missing = formatDuration(day.missingMinutes)

      if (dayReason === "daily-budget-exceeds-workable-capacity") {
        const budget = formatDuration(day.budgetMinutes)
        const capacity = formatDuration(day.workableCapacityMinutes)
        const employees = numberOf(day.availableEmployeeCount)
        const capacitySubject =
          employees === null
            ? "l'équipe disponible peut"
            : employees === 1
              ? "le salarié disponible peut"
              : `les ${employees} salariés disponibles peuvent`
        return {
          code: dayReason,
          message:
            `${date} : le budget impose ${budget ?? "un volume inconnu"} de travail, ` +
            `mais ${capacitySubject} fournir au maximum ${capacity ?? "un volume inférieur"} ` +
            `compte tenu de leurs disponibilités et limites quotidiennes.` +
            (missing ? ` Il manque ${missing} de capacité.` : "") +
            " Réduisez le budget de cette journée ou augmentez les disponibilités/capacités quotidiennes.",
        }
      }

      if (dayReason === "hard-floor-exceeds-available-minutes") {
        const hardMinimum = formatDuration(day.hardMinimumMinutes)
        const available = formatDuration(day.availableWorkedMinutes)
        const peakEmployees = numberOf(day.peakHardMinimumEmployees)
        const peakStart = formatClock(day.peakHardMinimumStartMinutes)
        const peakEnd = formatClock(day.peakHardMinimumEndMinutes)
        const peak =
          peakEmployees !== null && peakEmployees > 0 && peakStart && peakEnd
            ? ` Le pic obligatoire est de ${peakEmployees} salarié${peakEmployees > 1 ? "s" : ""} entre ${peakStart} et ${peakEnd}.`
            : ""
        return {
          code: dayReason,
          message:
            `${date} : les minimums de présence obligatoires demandent ` +
            `${hardMinimum ?? "plus d'heures que disponibles"}, mais seulement ` +
            `${available ?? "un volume inférieur"} peuvent être travaillées.` +
            (missing ? ` Il manque ${missing}.` : "") +
            peak +
            " Réduisez le minimum obligatoire sur ces créneaux ou ajoutez de la disponibilité.",
        }
      }

      return {
        code: dayReason,
        message: `${date} : la capacité disponible ne permet pas de respecter les contraintes obligatoires de cette journée.`,
      }
    })
  }

  if (reason === "sector-role-cannot-be-staffed") {
    const conflicts = recordsOf(envelope.diagnostics.infeasibleSectorRoles)
    if (conflicts.length === 0) {
      return [{
        code: reason,
        message: "Au moins un rayon ouvert ne possède pas assez de salariés autorisés et disponibles pour assurer son ouverture ou sa fermeture obligatoire.",
      }]
    }
    return conflicts.map((conflict) => {
      const date = formatIsoDate(conflict.date)
      const sector = typeof conflict.sectorName === "string" ? conflict.sectorName : "Rayon inconnu"
      const opensAt = formatClock(conflict.opensAtMinutes)
      const closesAt = formatClock(conflict.closesAtMinutes)
      const requiredOpeners = numberOf(conflict.requiredOpeners) ?? 0
      const openingCandidates = numberOf(conflict.openingCandidateCount) ?? 0
      const requiredClosers = numberOf(conflict.requiredClosers) ?? 0
      const closingCandidates = numberOf(conflict.closingCandidateCount) ?? 0
      const jointRoleConflict = conflict.jointRoleConflict === true
      const crossSectorConflict = conflict.crossSectorConflict === true
      const assigned = Array.isArray(conflict.assignedEmployeeNames)
        ? conflict.assignedEmployeeNames.filter((name): name is string => typeof name === "string")
        : []
      // Deux formes de phrase, et elles ne se joignent pas.
      //
      // Un effectif manquant se compte (« il faut 2 ouvreurs, mais 1
      // disponible ») ; un conflit de rôles se raconte (« l'ouverture et la
      // fermeture ne peuvent pas être tenues par la même personne »). Les
      // coller derrière un « il faut » commun produisait « il faut l'ouverture
      // à 07:00 et la fermeture à 18:00 doivent être réparties », que personne
      // ne peut lire.
      const shortages: string[] = []
      if (openingCandidates < requiredOpeners) {
        shortages.push(`${requiredOpeners} ouvreur${requiredOpeners > 1 ? "s" : ""} à ${opensAt ?? "l'ouverture"}, mais ${openingCandidates} disponible${openingCandidates > 1 ? "s" : ""}`)
      }
      if (closingCandidates < requiredClosers) {
        shortages.push(`${requiredClosers} fermeur${requiredClosers > 1 ? "s" : ""} à ${closesAt ?? "la fermeture"}, mais ${closingCandidates} disponible${closingCandidates > 1 ? "s" : ""}`)
      }

      // Ce qui BLOQUE réellement, et donc le levier à bouger.
      //
      // Le message annonçait « une limite continue de 8 h » quelle que soit la
      // règle qui mordait, alors que le nombre affiché est le minimum entre le
      // plafond quotidien et le plafond continu. Sur un rayon ouvert 11 h avec
      // une coupure maximale d'1 h 30, c'est le PLAFOND QUOTIDIEN qui refuse :
      // allonger la coupure autorisée résout la journée, augmenter le plafond
      // quotidien seul ne la résout pas. Envoyer le manager sur la mauvaise
      // règle est pire que ne rien dire.
      const solo = recordOf(conflict.soloRoleBlock)
      const remedies: string[] = ["affectez un second salarié disponible ce jour-là"]
      let jointSentence = ""
      if (jointRoleConflict) {
        const span = formatDuration(conflict.openingClosingSpanMinutes) ?? "toute l'amplitude du rayon"
        const worked = solo ? formatDuration(solo.soloWorkedMinutes) : null
        const cap = solo ? formatDuration(solo.dailyCapMinutes) : formatDuration(conflict.maximumSingleSpanMinutes)
        const requiredSplit = solo ? formatDuration(solo.requiredSplitMinutes) : null
        const maximumSplit = solo ? formatDuration(solo.maximumSplitMinutes) : null
        const splitAllowed = solo?.splitAllowed === true

        // D'OÙ vient le plafond. Trois réglages différents, trois écrans
        // différents : le contrat du salarié, la configuration du magasin, la
        // règle commune de la zone. Un « plafond de 8 h » sans sa provenance
        // fait chercher dans les trois.
        const employeeName = typeof solo?.employeeName === "string" ? solo.employeeName : null
        const capOrigin = ((): string => {
          switch (solo?.dailyCapSource) {
            case "contract":
              return employeeName ? ` fixé par le contrat de ${employeeName}` : " fixé par son contrat"
            case "sector":
              return " fixé par la durée maximale par jour de l'un de ses rayons"
            case "settings":
              return " fixé par les réglages de cette génération"
            case "store":
              return " fixé par la configuration du magasin"
            case "window":
            case "availability":
              return " imposé par sa fenêtre de disponibilité ce jour-là"
            case "zone":
              return " fixé par la règle commune des rayons sélectionnés"
            default:
              return ""
          }
        })()

        // Les trois plafonds, en clair, dès qu'ils ne disent pas la même chose.
        //
        // Nommer la source ne suffit pas : quatre allers-retours ont été perdus
        // parce que le lecteur corrigeait un réglage et retombait sur le même
        // refus, sans jamais voir LEQUEL des trois valait ce qu'il valait.
        // Afficher les nombres retire la dernière chose à deviner.
        const caps = [
          { label: "contrat", value: numberOf(solo?.contractCapMinutes) },
          { label: "journée", value: numberOf(solo?.dayCapMinutes) },
          { label: "règle commune", value: numberOf(solo?.zoneCapMinutes) },
        ].filter((entry): entry is { label: string; value: number } => entry.value !== null)
        const capBreakdown = new Set(caps.map((entry) => entry.value)).size > 1
          ? ` (${caps.map((entry) => `${entry.label} ${formatDuration(entry.value)}`).join(", ")})`
          : ""

        jointSentence =
          `l'ouverture à ${opensAt ?? "l'heure prévue"} et la fermeture à ${closesAt ?? "l'heure prévue"} ` +
          `ne peuvent pas être tenues par la même personne. `
        if (worked && cap) {
          jointSentence += splitAllowed && maximumSplit
            ? `Couvrir ${span} avec la coupure maximale de ${maximumSplit} demanderait ${worked} de travail à un seul salarié, au-dessus du plafond de ${cap}${capOrigin}${capBreakdown}. `
            : `Couvrir ${span} d'affilée demanderait ${worked} de travail à un seul salarié, au-dessus du plafond de ${cap}${capOrigin}${capBreakdown}. `
        } else {
          jointSentence += `Aucun candidat ne peut légalement cumuler les deux rôles sur ${span}. `
        }
        const raisedCap = formatDuration(solo?.soloWorkedMinutes)
        if (solo?.dailyCapSource === "contract" && raisedCap && employeeName) {
          remedies.push(`portez le maximum journalier du contrat de ${employeeName} à ${raisedCap}`)
        } else if (solo?.dailyCapSource === "sector" && raisedCap) {
          remedies.push(`portez la durée maximale par jour du rayon à ${raisedCap}`)
        } else if (solo?.dailyCapSource === "settings" && raisedCap) {
          remedies.push(`portez la durée maximale d'une journée de cette génération à ${raisedCap}`)
        } else if (solo?.dailyCapSource === "store" && raisedCap) {
          remedies.push(`portez la durée maximale d'une journée du magasin à ${raisedCap}`)
        }
        if (requiredSplit) {
          remedies.push(`portez la coupure maximale du rayon à au moins ${requiredSplit}`)
        } else if (!splitAllowed && solo?.sectorSplitAllowed === false) {
          remedies.push("autorisez la coupure sur ce rayon")
        } else if (!splitAllowed && solo?.employeeMaySplit === false) {
          remedies.push(
            employeeName
              ? `autorisez la coupure pour ${employeeName}`
              : "autorisez la coupure pour ce salarié"
          )
        }
      }
      // Qui est retenu ailleurs, et où. TOUS, pas seulement le premier trouvé :
      // corriger un seul bloqueur et relancer pour retomber sur le suivant est
      // une perte de temps que le moteur peut éviter en les nommant d'un coup.
      const heldElsewhere = recordsOf(conflict.heldElsewhere)
      const crossSectorDetail = crossSectorConflict
        ? (() => {
            const held = heldElsewhere.length > 0
              ? heldElsewhere
              : [{
                  employeeName: conflict.conflictingEmployeeName,
                  sectorName: conflict.conflictingSectorName,
                  startMinutes: conflict.conflictingStartMinutes,
                  endMinutes: conflict.conflictingEndMinutes,
                }]
            const phrases = held.map((entry) => {
              const employee = typeof entry.employeeName === "string" ? entry.employeeName : "un salarié"
              const otherSector = typeof entry.sectorName === "string" ? entry.sectorName : "un autre rayon"
              const start = formatClock(entry.startMinutes)
              const end = formatClock(entry.endMinutes)
              return `${employee} tient déjà ${otherSector}` + (start && end ? ` de ${start} à ${end}` : "")
            })
            // L'accord suit le SUJET, pas le nombre de bloqueurs.
            return ` ${phrases.join(" et ")} : ` + (assigned.length > 0
              ? "les salariés restants ne peuvent pas couvrir ensemble l'ouverture et la fermeture de ce rayon."
              : "personne ne peut couvrir l'ouverture et la fermeture de ce rayon.")
          })()
        : ""
      remedies.push("ou fermez le rayon pour cette journée")
      const cause = [
        shortages.length > 0 ? `il faut ${shortages.join(" ; ")}.` : "",
        jointSentence,
      ].filter((part) => part.length > 0).join(" ")

      return {
        code: reason,
        message:
          `${date} — ${sector} : ${cause}`.trimEnd() + " " +
          crossSectorDetail.trim() + (crossSectorDetail.trim() ? " " : "") +
          (assigned.length > 0
            ? `Salarié${assigned.length > 1 ? "s" : ""} actuellement autorisé${assigned.length > 1 ? "s" : ""} : ${assigned.join(", ")}. `
            : "Aucun salarié n'est autorisé dans ce rayon. ") +
          `Pour débloquer la journée : ${remedies.join(", ")}.`,
      }
    })
  }

  if (reason === "optional-work-days-not-supported") {
    const count = numberOf(envelope.diagnostics.optionalCellCount) ?? 0
    return [
      {
        code: reason,
        message:
          `Ce moteur exige actuellement que chaque journée disponible soit travaillée. ` +
          `${count} journée(s) disponible(s) ont été déclarée(s) facultative(s).`,
      },
    ]
  }

  // Le verdict le plus FRÉQUENT du moteur, et il n'avait aucun branchement :
  // il tombait dans le fourre-tout « sans détail exploitable supplémentaire »,
  // en jetant les diagnostics les plus riches que le pipeline produise. Le
  // moteur note pourtant, en français et par cellule, ce qui l'a arrêté —
  // journées sans forme légale, domaine de durées vide, placement refusé — et
  // ces notes sont exactement ce qu'il faut lire pour savoir quoi corriger.
  if (reason === "no-legal-schedule-in-the-explored-neighbourhood") {
    const notes = Array.isArray(envelope.diagnostics.notes)
      ? envelope.diagnostics.notes.filter((note): note is string => typeof note === "string")
      : []
    const skeletonsPlaced = numberOf(envelope.diagnostics.skeletonsPlaced) ?? 0
    const placementsInfeasible = numberOf(envelope.diagnostics.placementsInfeasible) ?? 0
    const allocationsTested = numberOf(envelope.diagnostics.allocationsTested) ?? 0

    // Ce qui a échoué, du plus concret au plus vague.
    //
    // La journée fautive passe devant tout le reste : un compte de refus ne dit
    // rien à personne, une DATE se corrige.
    const blamed = Array.isArray(envelope.diagnostics.daysWithoutPlacement)
      ? envelope.diagnostics.daysWithoutPlacement.filter((date): date is string => typeof date === "string")
      : []
    let cause: string
    if (blamed.length > 0) {
      cause =
        `${blamed.length > 1 ? "Les journées" : "La journée"} du ${blamed.map(formatIsoDate).join(", du ")} ` +
        `ne peu${blamed.length > 1 ? "vent" : "t"} pas être servie${blamed.length > 1 ? "s" : ""} : ` +
        "les ouvertures et fermetures obligatoires de ses rayons ne peuvent pas être tenues ensemble " +
        "par les salariés disponibles ce jour-là, quelles que soient les heures choisies."
    } else if (notes.some((note) => note.includes("sans forme légale"))) {
      cause =
        "certaines journées n'admettent aucune forme d'horaire légale : la durée à placer n'entre pas " +
        "dans la fenêtre du salarié une fois le repos, la durée minimale et les coupures autorisées appliqués."
    } else if (notes.some((note) => note.includes("aucune allocation ne satisfait"))) {
      cause =
        "aucune répartition des minutes ne satisfait à la fois les contrats, les budgets quotidiens " +
        "et les durées réellement plaçables."
    } else if (placementsInfeasible > 0) {
      cause =
        `${placementsInfeasible} placement${placementsInfeasible > 1 ? "s ont" : " a"} été refusé${placementsInfeasible > 1 ? "s" : ""} : ` +
        "les durées retenues n'admettent aucun horaire simultané respectant le repos et les planchers de présence."
    } else if (skeletonsPlaced === 0) {
      cause = "aucun placement n'a pu être tenté dans le temps imparti."
    } else {
      cause =
        "aucun des horaires essayés ne respecte toutes les règles à la fois, " +
        "sans qu'une contrainte unique puisse être désignée."
    }

    return [{
      code: reason,
      message:
        `${cause} Ce n'est PAS une preuve d'impossibilité : la recherche est heuristique et n'a exploré ` +
        `qu'une partie des plannings possibles (${allocationsTested} répartition${allocationsTested > 1 ? "s" : ""} ` +
        `essayée${allocationsTested > 1 ? "s" : ""}, ${skeletonsPlaced} placement${skeletonsPlaced > 1 ? "s" : ""}). ` +
        `Relancer avec un budget de temps plus large peut aboutir.` +
        (notes.length > 0 ? ` Détail du moteur : ${notes.slice(0, 3).join(" | ")}` : ""),
    }]
  }

  if (reason === "allocation-feasibility-probe-ended-without-proof") {
    return [
      {
        code: reason,
        message:
          "Le contrôle initial des contrats et budgets s'est arrêté sans solution et sans preuve d'infaisabilité.",
      },
    ]
  }

  if (reason === "no-minute-allocation-satisfies-contracts-and-budgets") {
    const employeeConflicts = recordsOf(envelope.diagnostics.allocationEmployeeConflicts)
    const dayConflicts = recordsOf(envelope.diagnostics.allocationDayConflicts)
    const entries = [
      ...employeeConflicts.map((conflict) => {
        const name = typeof conflict.employeeName === "string"
          ? conflict.employeeName
          : "Un salarié"
        const contract = formatDuration(conflict.contractMinutes) ?? "un volume inconnu"
        const minimum = formatDuration(conflict.minimumPossibleMinutes) ?? "un minimum inconnu"
        const maximum = formatDuration(conflict.maximumPossibleMinutes) ?? "une capacité inconnue"
        const difference = formatDuration(conflict.differenceMinutes)
        const days = numberOf(conflict.availableDayCount)
        const availability = days === null
          ? "ses jours et horaires disponibles"
          : `${days} jour${days > 1 ? "s" : ""} disponible${days > 1 ? "s" : ""}`

        if (conflict.reason === "contract-below-mandatory-minimum") {
          return {
            code: "employee-volume-below-mandatory-minimum",
            message:
              `${name} reçoit ${contract} dans ce rayon, mais ${availability} imposent au moins ${minimum} ` +
              `avec la durée minimale quotidienne.` +
              (difference ? ` Il manque ${difference}.` : "") +
              " Réduisez ses jours travaillés dans ce rayon ou augmentez son volume attribué.",
          }
        }
        return {
          code: "employee-volume-exceeds-available-capacity",
          message:
            `${name} reçoit ${contract} dans ce rayon, mais ${availability} permettent au maximum ${maximum} ` +
            `compte tenu de ses bornes horaires et de la durée continue autorisée.` +
            (difference ? ` Retirez au moins ${difference}.` : "") +
            " Ajoutez un autre salarié prioritaire ou élargissez ses disponibilités.",
        }
      }),
      ...dayConflicts.map((conflict) => {
        const date = formatIsoDate(conflict.date)
        const budget = formatDuration(conflict.budgetMinutes) ?? "un volume inconnu"
        const minimum = formatDuration(conflict.minimumMandatoryMinutes) ?? "un minimum inconnu"
        const maximum = formatDuration(conflict.maximumCapacityMinutes) ?? "une capacité inconnue"
        const difference = formatDuration(conflict.differenceMinutes)
        const employees = numberOf(conflict.availableEmployeeCount)
        const team = employees === null
          ? "les salariés disponibles"
          : `${employees} salarié${employees > 1 ? "s" : ""} disponible${employees > 1 ? "s" : ""}`

        if (conflict.reason === "budget-below-mandatory-minimum") {
          return {
            code: "daily-budget-below-mandatory-minimum",
            message:
              `${date} : le rayon prévoit ${budget}, mais ${team} doivent travailler au moins ${minimum} au total.` +
              (difference ? ` Le budget est trop bas de ${difference}.` : "") +
              " Retirez un salarié obligatoire ce jour-là, ajoutez un repos fixe ou augmentez le budget.",
          }
        }
        return {
          code: "daily-budget-exceeds-capacity",
          message:
            `${date} : le rayon prévoit ${budget}, mais ${team} peuvent fournir au maximum ${maximum}.` +
            (difference ? ` Il manque ${difference} de capacité.` : "") +
            " Ajoutez de la disponibilité ou réduisez le besoin de cette journée.",
        }
      }),
    ]
    if (entries.length > 0) return entries

    const totals = recordOf(envelope.diagnostics.allocationTotals)
    const employees = numberOf(totals?.employeeCount)
    const days = numberOf(totals?.openDayCount)
    const volume = formatDuration(totals?.budgetMinutes)
    return [{
      code: reason,
      message:
        `Les volumes hebdomadaires concordent${volume ? ` (${volume})` : ""}, mais ils ne peuvent pas être ` +
        `répartis entre${employees === null ? " les salariés" : ` ${employees} salarié${employees > 1 ? "s" : ""}`} ` +
        `sur${days === null ? " les jours ouverts" : ` ${days} jour${days > 1 ? "s" : ""} ouvert${days > 1 ? "s" : ""}`} ` +
        "sans enfreindre une durée minimale, une disponibilité ou une limite quotidienne. " +
        "Vérifiez en priorité les jours de travail, repos fixes et bornes horaires des salariés sélectionnés.",
    }]
  }

  return [{
    code: reason,
    message: "Le moteur a identifié une incompatibilité entre les règles de cette semaine, sans détail exploitable supplémentaire.",
  }]
}

function recordsOf(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
  )
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function formatIsoDate(value: unknown): string {
  if (typeof value !== "string") return "Journée inconnue"
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

function formatDuration(value: unknown): string | null {
  const minutes = numberOf(value)
  if (minutes === null) return null
  const rounded = Math.max(0, Math.round(minutes))
  const hours = Math.floor(rounded / 60)
  const remainder = rounded % 60
  if (hours === 0) return `${remainder} min`
  if (remainder === 0) return `${hours} h`
  return `${hours} h ${String(remainder).padStart(2, "0")}`
}

function formatClock(value: unknown): string | null {
  const minutes = numberOf(value)
  if (minutes === null) return null
  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  const remainder = ((rounded % 60) + 60) % 60
  return `${String(hours).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
}

function emptyStatistics(envelope: HighsFastResponseEnvelope) {
  return {
    candidatesGenerated: numberOf(envelope.diagnostics.shiftsGenerated) ?? 0,
    dailyPatternsEvaluated: numberOf(envelope.diagnostics.skeletonsGenerated) ?? 0,
    weeklyStatesEvaluated: numberOf(envelope.diagnostics.uniqueAllocations) ?? 0,
    branchesPrunedByBound: 0,
    branchesPrunedByFeasibility: numberOf(envelope.diagnostics.placementsInfeasible) ?? 0,
    durationMs: Math.round((numberOf(envelope.diagnostics.totalSeconds) ?? 0) * 1000),
    peakOpenNodes: 0,
  }
}

/**
 * The engine internals a support log needs, already worded.
 *
 * Kept in `technical` rather than in `entries`: none of it asks a manager for a
 * decision, and a diagnostic that requires no decision must never appear where
 * the ones that do are read.
 */
function technicalFacts(envelope: HighsFastResponseEnvelope): SolveTechnicalFact[] {
  const facts: SolveTechnicalFact[] = [
    { label: "Moteur", value: "HiGHS décomposé (Python, sous-processus)" },
    { label: "Verdict moteur", value: String(envelope.diagnostics.engineStatus ?? "inconnu") },
  ]
  const push = (label: string, raw: unknown, suffix = ""): void => {
    const value = numberOf(raw)
    if (value !== null) facts.push({ label, value: `${value}${suffix}` })
  }
  push("Temps total", envelope.diagnostics.totalSeconds, " s")
  push("Squelettes générés", envelope.diagnostics.skeletonsGenerated)
  push("MILP d'allocation résolus", envelope.diagnostics.skeletonAllocationsSolved)
  push("Créneaux sous-couverts", envelope.diagnostics.referenceShortSlots)
  push("Minutes manquantes", envelope.diagnostics.referenceDeficitMinutes)
  if (envelope.diagnostics.usedAllocationFirstFallback === true) {
    facts.push({ label: "Complément", value: "ordre allocation → squelette" })
  }
  const python = envelope.environment.python
  if (typeof python === "string") facts.push({ label: "Python", value: python })
  return facts
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function failure(
  request: SolvePlanningRequest,
  code: string,
  message: string
): SolvePlanningResponse {
  return toBackendErrorResponse("highs-fast", new Error(`${code} — ${message}`), request)
}

function resolveScriptPath(): string {
  return `${process.cwd()}/${defaultHighsFastScriptPath()}`
}

function resolveWorkingDirectory(): string {
  return `${process.cwd()}/experiments/planning-v3-highs`
}

export { resolveHighsFastPython } from "@/features/core/planning-contract/adapters/python/run-python"
export {
  HIGHS_FAST_PROTOCOL_VERSION,
  parseHighsFastResponse,
} from "@/features/core/planning-contract/adapters/highs-fast/protocol"
export type {
  HighsFastRequestEnvelope,
  HighsFastResponseEnvelope,
} from "@/features/core/planning-contract/adapters/highs-fast/protocol"
