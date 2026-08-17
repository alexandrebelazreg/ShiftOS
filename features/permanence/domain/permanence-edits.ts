import type { IsoDate } from "@/features/core/models"
import {
  PERMANENCE_ROLES,
  permanenceSlotKey,
  type PermanenceMonth,
  type PermanenceRole,
} from "@/features/permanence/models/permanence-month"

/**
 * Les retouches à la main, et la seule règle qu'elles respectent.
 *
 * ÊTRE DE REPOS ET PORTER LES CLÉS LE MÊME JOUR EST IMPOSSIBLE. La feuille
 * pouvait afficher les deux — c'était du papier. Ici, poser l'un retire
 * l'autre, dans les deux sens : une règle qui ne vaudrait que dans un sens
 * laisserait la contradiction atteignable par l'autre chemin, et le
 * récapitulatif compterait alors une fermeture faite par quelqu'un qui n'était
 * pas là.
 *
 * Écrit ici plutôt que dans l'écran : c'est une règle du domaine, elle se
 * vérifie sans navigateur, et l'écran ne fait que l'appeler.
 */

/** Poser ou retirer un repos. Le repos posé chasse la permanence du jour. */
export function toggleRest(
  month: PermanenceMonth,
  date: IsoDate,
  employeeId: string
): PermanenceMonth {
  const current = month.rest[date] ?? []
  const resting = current.includes(employeeId)

  const rest = { ...month.rest }
  if (resting) {
    const remaining = current.filter((entry) => entry !== employeeId)
    if (remaining.length === 0) delete rest[date]
    else rest[date] = remaining
    // Retirer un repos ne rend personne à une permanence : la case libérée
    // reste libre, et c'est au gérant de dire qui la reprend.
    return { ...month, rest }
  }

  rest[date] = [...current, employeeId]
  return { ...month, rest, assignments: withoutPersonOn(month.assignments, date, employeeId) }
}

/** Affecter une case, ou la vider. L'affectation chasse le repos du jour. */
export function assign(
  month: PermanenceMonth,
  date: IsoDate,
  role: PermanenceRole,
  employeeId: string | null
): PermanenceMonth {
  const assignments = { ...month.assignments }
  const key = permanenceSlotKey(date, role)
  if (employeeId === null) {
    delete assignments[key]
    return { ...month, assignments }
  }

  assignments[key] = employeeId
  return { ...month, assignments, rest: withoutRestOn(month.rest, date, employeeId) }
}

/** Les mêmes affectations, sans celles de cette personne ce jour-là. */
function withoutPersonOn(
  assignments: Readonly<Record<string, string>>,
  date: IsoDate,
  employeeId: string
): Readonly<Record<string, string>> {
  const next = { ...assignments }
  for (const role of PERMANENCE_ROLES) {
    const key = permanenceSlotKey(date, role)
    if (next[key] === employeeId) delete next[key]
  }
  return next
}

/** Les mêmes repos, sans celui de cette personne ce jour-là. */
function withoutRestOn(
  rest: Readonly<Record<IsoDate, readonly string[]>>,
  date: IsoDate,
  employeeId: string
): Readonly<Record<IsoDate, readonly string[]>> {
  const resting = rest[date]
  if (!resting?.includes(employeeId)) return rest

  const next = { ...rest }
  const remaining = resting.filter((entry) => entry !== employeeId)
  if (remaining.length === 0) delete next[date]
  else next[date] = remaining
  return next
}
