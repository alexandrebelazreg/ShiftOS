import { browserStore } from "@/features/core/shared/key-value-store"
import { createAbsenceRepository } from "@/features/absences/persistence/absence.repository"
import type {
  AbsenceDraft,
  AbsenceRepository,
} from "@/features/absences/persistence/absence.repository"

/**
 * Le magasin des absences, lié au navigateur.
 *
 * Toute la logique vit désormais dans `absence.repository.ts`, qui reçoit son
 * stockage. Ce fichier ne dit plus que *où* les absences sont rangées.
 *
 * La clé n'a pas changé : les absences déjà enregistrées doivent continuer de
 * se relire, et un écran qui ne verrait que ses propres saisies mentirait sur
 * qui est présent.
 *
 * Le stockage est résolu à chaque appel, jamais capturé à l'import : un rendu
 * serveur trouverait l'oubli et le garderait pour toute la vie du module.
 */
function repository(): AbsenceRepository {
  return createAbsenceRepository(browserStore())
}

export const absenceService: AbsenceRepository = {
  list: () => repository().list(),
  create: (draft, today, rules) => repository().create(draft, today, rules),
  extend: (id, newEnd, today) => repository().extend(id, newEnd, today),
  cancel: (id, today) => repository().cancel(id, today),
  markProofReceived: (id, receivedOn) => repository().markProofReceived(id, receivedOn),
}

export type { AbsenceDraft }
