import { HOURS_TREATMENTS } from "@/features/absences/models/absence-motive"
import {
  DEFAULT_ABSENCE_RULES,
  type AbsenceRules,
} from "@/features/absences/models/absence-rules"

/**
 * Les écarts au tableau des motifs, conservés pour ce magasin.
 *
 * Une seule clé et non une par motif : ces réglages se lisent TOUS ensemble, à
 * chaque ouverture de l'écran des absences, et un balayage de onze clés pour
 * reconstituer un objet qui tient en trois lignes ne servirait personne.
 */

const RULES_KEY = "shiftos_absence_rules"

export interface AbsenceRulesRepository {
  read(): AbsenceRules
  save(rules: AbsenceRules): void
  /** Efface tous les écarts : le tableau d'origine s'applique de nouveau. */
  reset(): void
}

export function createAbsenceRulesRepository(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem">
): AbsenceRulesRepository {
  return {
    read() {
      try {
        const value: unknown = JSON.parse(storage.getItem(RULES_KEY) ?? "null")
        return isAbsenceRules(value) ? value : DEFAULT_ABSENCE_RULES
      } catch {
        // Un stockage illisible vaut « aucun écart » : les absences continuent
        // de se saisir avec les règles d'origine plutôt que de refuser l'écran.
        return DEFAULT_ABSENCE_RULES
      }
    },
    save(rules) {
      storage.setItem(RULES_KEY, JSON.stringify(rules))
    },
    reset() {
      storage.removeItem(RULES_KEY)
    },
  }
}

function isAbsenceRules(value: unknown): value is AbsenceRules {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false

  return Object.values(value as Record<string, unknown>).every((override) => {
    if (typeof override !== "object" || override === null) return false
    const rule = override as Record<string, unknown>

    const hoursValid =
      rule.hours === undefined ||
      HOURS_TREATMENTS.includes(rule.hours as (typeof HOURS_TREATMENTS)[number])
    if (!hoursValid) return false

    if (rule.proof === undefined) return true
    if (typeof rule.proof !== "object" || rule.proof === null) return false
    const proof = rule.proof as Record<string, unknown>
    return (
      typeof proof.expected === "boolean" &&
      (proof.dueDays === null ||
        (typeof proof.dueDays === "number" && Number.isInteger(proof.dueDays) && proof.dueDays >= 0))
    )
  })
}
