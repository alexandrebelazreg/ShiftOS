import type { PlanningProblemV3 } from "@/features/core/planning-v3/types/problem"
import type { PlanningSolutionV3 } from "@/features/core/planning-v3/types/solution"
import type { PlanningValidationReportV3 } from "@/features/core/planning-v3/types/validation"
import { fingerprintProblem, validatePlanningSolutionV3 } from "@/features/core/planning-v3/validator"

import { checkSolvePlanningResponse } from "@/features/core/planning-contract/invariants"
import { requestedPreservations } from "@/features/core/planning-contract/types/solve-request"
import type { SolvePlanningRequest } from "@/features/core/planning-contract/types/solve-request"
import type { SolvePlanningResponse } from "@/features/core/planning-contract/types/solve-response"

/**
 * The gate a V3 answer must pass before it may be shown as the active planning.
 *
 * Pure, and run on the CLIENT even though the route handler already validated
 * on the server. That is not paranoia about the network: the two checks answer
 * different questions. The server asks "did my engine behave"; this asks "may I
 * put this in front of a manager and let them publish it". The second is the
 * one that matters here, it is cheap, and the day the transport changes — a
 * cache, a worker, a replay of a stored response — it is the only one still
 * standing between a bad schedule and the screen.
 *
 * Every rejection reason is a REFUSAL TO DISPLAY, never a fallback. Nothing here
 * reaches for V2.
 */

export const V3_REJECTION_REASONS = [
  "outcome-not-publishable",
  "no-solution",
  "contract-violated",
  "wrong-problem",
  "hard-constraints-violated",
  "preservation-not-respected",
] as const
export type V3RejectionReason = (typeof V3_REJECTION_REASONS)[number]

export type V3Acceptance =
  | {
      readonly accepted: true
      readonly solution: PlanningSolutionV3
      readonly report: PlanningValidationReportV3
      /**
       * True when the schedule is legal but carries costs a human must own.
       * Displayable; publishable only after an explicit acceptance.
       */
      readonly requiresExplicitAcceptance: boolean
    }
  | {
      readonly accepted: false
      readonly reason: V3RejectionReason
      readonly message: string
      /** What the validator found, when it is what refused. */
      readonly report?: PlanningValidationReportV3
    }

export function acceptV3Result(
  request: SolvePlanningRequest,
  response: SolvePlanningResponse
): V3Acceptance {
  // 1. The engine's own verdict must be one that carries a schedule at all.
  if (response.outcome !== "optimal" && response.outcome !== "feasible") {
    return {
      accepted: false,
      reason: "outcome-not-publishable",
      message: nonPublishableMessage(response),
    }
  }

  if (response.solution === null) {
    return {
      accepted: false,
      reason: "no-solution",
      message: "Le moteur V3 annonce une solution sans en joindre aucune.",
    }
  }

  // 2. The response must be internally coherent. A response that breaks the
  // contract is an engine defect, and an engine caught defective on the shape
  // of its answer has not earned trust about its content.
  const violations = checkSolvePlanningResponse(response)
  if (violations.length > 0) {
    return {
      accepted: false,
      reason: "contract-violated",
      message: `Réponse V3 non conforme au contrat : ${violations.map((entry) => entry.code).join(", ")}.`,
    }
  }

  // 3. The schedule must answer the problem that was actually asked. Cheap, and
  // the only thing standing between a stale or replayed response and a manager
  // publishing last week's schedule under this week's header.
  const expected = fingerprintProblem(request.problem)
  if (response.solution.problemFingerprint !== expected) {
    return {
      accepted: false,
      reason: "wrong-problem",
      message: `Le planning reçu répond à un autre problème (${response.solution.problemFingerprint} au lieu de ${expected}).`,
    }
  }

  // 4. Re-audited from scratch, here, against the problem this client built.
  const report = validatePlanningSolutionV3(request.problem, response.solution)
  if (!report.validHardConstraints) {
    return {
      accepted: false,
      reason: "hard-constraints-violated",
      message: `Le validateur indépendant rejette ce planning : ${report.violations.length} violation(s) bloquante(s).`,
      report,
    }
  }

  // 5. What the manager asked to protect must actually have been protected.
  const requested = requestedPreservations(request)
  const unmet = response.metadata.unmetPreservations
  if (
    (requested.locks && unmet.includes("locks")) ||
    (requested.manualEdits && unmet.includes("manual-edits"))
  ) {
    return {
      accepted: false,
      reason: "preservation-not-respected",
      message: `Le moteur n'a pas respecté : ${unmet.join(", ")}. Le planning n'est pas celui qui a été demandé.`,
      report,
    }
  }

  return {
    accepted: true,
    solution: response.solution,
    report,
    requiresExplicitAcceptance: report.requiresExplicitAcceptance,
  }
}

function nonPublishableMessage(response: SolvePlanningResponse): string {
  switch (response.outcome) {
    case "infeasible":
      return "Les contrats, disponibilités et budgets de la semaine ne peuvent pas tous être respectés en même temps."
    case "timeout-without-solution":
      return "La recherche s’est arrêtée avant de trouver un planning. Cela ne prouve pas que la semaine est impossible."
    case "backend-error":
      return "Le moteur de calcul n’a pas pu terminer la demande. Vos règles ne sont pas nécessairement en cause."
    case "invalid-problem":
      return "Certaines données de configuration ne peuvent pas être utilisées par le moteur dans leur état actuel."
    case "cancelled":
      return "La recherche a été annulée avant de produire un planning."
    default:
      return "Aucun planning exploitable n’a été produit pour cette tentative."
  }
}

/**
 * The one-line label the screen shows for an accepted V3 planning.
 *
 * It names the engine that ACTUALLY answered. The label used to be the literal
 * "V3 expérimental" whatever ran, so a manager who deliberately selected one
 * engine was told they had another — and any report they wrote about a bad week
 * named the wrong solver. The engine is reporting-only in the contract, and
 * this is exactly the reporting it exists for.
 */
const ENGINE_LABELS: Readonly<Record<string, string>> = {
  "cp-sat": "V3 expérimental (CP-SAT)",
  "decomposed-v3": "V3 décomposé",
  "highs-fast": "V3 rapide (HiGHS)",
  "dfs-v3": "V3 prototype (DFS)",
  v2: "V2 stable",
}

export function describeV3Engine(response: SolvePlanningResponse): string {
  const engine = ENGINE_LABELS[response.metadata.engine] ?? "V3 expérimental"
  return response.outcome === "optimal"
    ? `${engine} — optimum démontré`
    : `${engine} — solution faisable, optimalité non prouvée`
}

/**
 * Why a feasible answer is only feasible, for the technical drawer.
 *
 * Kept off the main screen: "the split-shift space is not enumerated" is a true
 * and important caveat, and it is also not something a manager can act on while
 * looking at a week. It belongs where someone goes to ask why.
 */
export function v3TechnicalCaveats(
  response: SolvePlanningResponse,
  problem: PlanningProblemV3
): readonly { readonly label: string; readonly value: string }[] {
  const caveats = [...response.diagnostics.technical, ...closingFairnessFacts(response, problem)]
  if (response.metadata.candidateSpace === "incomplete") {
    caveats.unshift({
      label: "Espace de recherche incomplet",
      value: incompleteSpaceReason(response, problem),
    })
  }
  return caveats
}

/**
 * Les lignes d'équité, et sous quel intitulé elles se lisent.
 *
 * Le détail du jour porte le sien : c'est la seule ligne qui répond à
 * « pourquoi lui et pas elle », et la noyer sous le même titre que les totaux
 * la ferait passer pour une répétition.
 */
const FAIRNESS_LABELS: Record<string, string> = {
  "closing-fairness": "Équité des fermetures",
  "saturday-closing-fairness": "Équité des fermetures",
  "closing-fairness-day": "Équité — qui pouvait fermer ce jour-là",
  "closing-quota": "Équité — plafond imposé cette semaine",
}

/**
 * L'équité des fermetures, rendue lisible — sinon elle reste invisible.
 *
 * Le validateur produisait déjà ces chiffres, un par salarié plus un écart de
 * synthèse, et **aucun écran ne les lisait**. Le gérant réglait donc une
 * balance dont il ne pouvait observer ni le fonctionnement ni la panne : la
 * seule chose dont il disposait était son impression.
 *
 * La première ligne compte plus que toutes les autres. Quand la fenêtre
 * d'historique ne contient aucune semaine publiée, le rapport dit « 0 fermeture
 * sur 0 occasion » pour TOUT LE MONDE — ce qui se lit à tort comme « c'est
 * équilibré » alors que cela veut dire « il n'y a rien à équilibrer ». Le dire
 * en toutes lettres est la différence entre un réglage qu'on croit cassé et un
 * réglage qui attend simplement sa première semaine.
 */
function closingFairnessFacts(
  response: SolvePlanningResponse,
  problem: PlanningProblemV3
): readonly { readonly label: string; readonly value: string }[] {
  const fairness = problem.rules.closingFairness
  if (!fairness || (!fairness.balanceClosings && !fairness.balanceSaturdayClosings)) return []

  const facts: { label: string; value: string }[] = []
  const history = problem.closingHistory ?? []
  // Une occasion, pas une fermeture : quelqu'un qui n'a jamais pu fermer ne
  // porte aucune information, et un historique fait uniquement de ceux-là est
  // aussi vide qu'un historique absent.
  if (!history.some((entry) => entry.opportunities > 0)) {
    facts.push({
      label: "Équité des fermetures — sans effet cette semaine",
      value: `Aucune semaine publiée dans les ${fairness.lookbackWeeks} dernières semaines : tout le monde part à égalité, donc la balance ne départage personne. Publiez une semaine pour qu'elle commence à compter.`,
    })
  }

  for (const entry of response.diagnostics.entries) {
    const label = FAIRNESS_LABELS[entry.code]
    if (label) facts.push({ label, value: entry.message })
  }
  return facts
}

/**
 * WHY the space is incomplete, per engine. Not one sentence for all of them.
 *
 * The single wording named split shifts as the cause, which was true of the
 * prototype it was written for and false of every engine added since. Told a
 * manager the HiGHS engine does not enumerate splits — it does, forced and
 * opportunistic both — and hid the real reason, which is that it ranks a
 * bounded set of skeletons and allocations rather than all of them.
 *
 * A caveat that states a false cause is worse than no caveat: it is the answer
 * to "why is this not optimal", and someone acting on it would go looking at
 * the split rules.
 */
function incompleteSpaceReason(
  response: SolvePlanningResponse,
  problem: PlanningProblemV3
): string {
  if (response.metadata.engine === "highs-fast") {
    return "Ce moteur classe un nombre borné de squelettes et résout une allocation par squelette : il énumère bien les coupures, mais n'explore qu'une partie de l'espace, donc aucun optimum ne peut être annoncé."
  }
  if (response.metadata.engine === "decomposed-v3") {
    return "Ce moteur explore un espace délibérément réduit — les premières allocations de minutes, les meilleurs motifs de chaque journée : une bonne réponse à une question plus petite n'est pas un optimum."
  }
  return problem.rules.splitShiftAllowed
    ? "Le secteur autorise les coupures, que ce moteur n'énumère pas : les shifts continus rendus restent légaux, mais aucun optimum global ne peut être annoncé."
    : "L'espace des shifts n'a pas été énuméré entièrement : aucun optimum ne peut être annoncé."
}
