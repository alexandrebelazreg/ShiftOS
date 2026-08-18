import type { AbsenceType } from "@/features/core/models"

import {
  absenceMotiveDefinition,
  type AbsenceMotiveDefinition,
  type HoursTreatment,
} from "@/features/absences/models/absence-motive"

/**
 * Ce qu'un magasin peut changer au tableau des motifs, et ce qu'il ne peut pas.
 *
 * SE RÈGLE : le traitement des heures, et le justificatif attendu. Ce sont des
 * conventions — elles diffèrent d'une branche à l'autre, d'un accord d'entreprise
 * à l'autre, et un gérant qui découvre que sa convention paie le congé parental
 * ne doit pas attendre une mise à jour de l'application.
 *
 * NE SE RÈGLE PAS : le libellé, le fait qu'un motif se compte en heures, celui
 * qu'il réclame une précision écrite. Ce ne sont pas des conventions mais la
 * nature du motif — des heures de délégation comptées en journées ne sont plus
 * des heures de délégation, et personne ne gagne à pouvoir renommer « Maladie ».
 *
 * Un réglage ABSENT vaut « comme prévu » : le stockage ne garde que les écarts,
 * si bien qu'une règle par défaut corrigée dans une version suivante profite aux
 * magasins qui n'y avaient pas touché.
 */

export interface AbsenceProofRule {
  /** Un papier est-il attendu ? Faux : aucune relance ne sera faite. */
  readonly expected: boolean
  /** Jours après le début. `null` : attendu, sans délai opposable. */
  readonly dueDays: number | null
}

export interface AbsenceRuleOverride {
  readonly hours?: HoursTreatment
  readonly proof?: AbsenceProofRule
}

/** Les écarts au tableau par défaut, motif par motif. */
export type AbsenceRules = Readonly<Record<string, AbsenceRuleOverride>>

/** Aucun écart : le tableau s'applique tel qu'il est écrit. */
export const DEFAULT_ABSENCE_RULES: AbsenceRules = {}

/**
 * La définition telle qu'elle s'applique vraiment, écarts compris.
 *
 * Une seule fonction, appelée partout où une règle se lit — la saisie, le calcul
 * du délai de justificatif, les relances. Lire `ABSENCE_MOTIVE_DEFAULTS`
 * directement continuerait de fonctionner, silencieusement, en ignorant ce que
 * le gérant a réglé : c'est la panne qu'aucun test ne montre.
 */
export function resolveMotive(
  rules: AbsenceRules,
  type: AbsenceType
): AbsenceMotiveDefinition {
  const definition = absenceMotiveDefinition(type)
  const override = rules[definition.value]
  if (override === undefined) return definition

  return {
    ...definition,
    hours: override.hours ?? definition.hours,
    proof: resolveProof(definition, override.proof),
  }
}

function resolveProof(
  definition: AbsenceMotiveDefinition,
  override: AbsenceProofRule | undefined
): AbsenceMotiveDefinition["proof"] {
  if (override === undefined) return definition.proof
  if (!override.expected) return null
  return {
    // Le nom du papier suit le motif et ne se saisit pas : « Justificatif »
    // couvre le cas d'un motif qui n'en attendait aucun et à qui on vient d'en
    // demander un.
    label: definition.proof?.label ?? "Justificatif",
    dueDays: override.dueDays,
  }
}

/** La règle en vigueur diffère-t-elle de celle d'origine ? */
export function isModified(rules: AbsenceRules, type: AbsenceType): boolean {
  const applied = resolveMotive(rules, type)
  const original = absenceMotiveDefinition(type)
  return (
    applied.hours !== original.hours ||
    applied.proof?.label !== original.proof?.label ||
    applied.proof?.dueDays !== original.proof?.dueDays
  )
}

/**
 * Enregistre un écart, ou l'efface quand il rejoint la valeur d'origine.
 *
 * Effacer plutôt que garder un écart devenu identique : sans cela, un motif
 * remis à sa valeur par défaut resterait marqué « modifié » à l'écran, et
 * n'hériterait plus jamais d'une correction du tableau.
 */
export function withRule(
  rules: AbsenceRules,
  type: AbsenceType,
  change: AbsenceRuleOverride
): AbsenceRules {
  const definition = absenceMotiveDefinition(type)
  const merged: AbsenceRules = {
    ...rules,
    [definition.value]: { ...rules[definition.value], ...change },
  }
  if (!isModified(merged, type)) {
    const rest: Record<string, AbsenceRuleOverride> = { ...merged }
    delete rest[definition.value]
    return rest
  }
  return merged
}
