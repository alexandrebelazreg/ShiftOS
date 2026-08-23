import { browserStore } from "@/features/core/shared/key-value-store"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { createSupabaseBrowserClient } from "@/features/auth/supabase/browser"
import {
  createEmployeeRepository,
  normalizeContract,
} from "@/features/employees/persistence/employee.repository"
import { createSupabaseEmployeeRepository } from "@/features/employees/persistence/employee.supabase-repository"
import type { EmployeeRepository } from "@/features/employees/persistence/employee.repository"

/**
 * Le dépôt des salariés, et le choix de sa source.
 *
 * Base quand elle est configurée, `localStorage` sinon. Ce n'est pas une
 * transition molle : c'est ce qui permet à l'application de continuer de
 * fonctionner sur un poste dont les variables ne sont pas posées, et de rendre
 * la bascule réversible en retirant une variable d'environnement.
 *
 * Les neuf appelants ne changent pas, et ne peuvent pas savoir laquelle des
 * deux ils tiennent. C'est exactement ce que le patron dépôt existait pour
 * permettre.
 *
 * Résolu à chaque appel, jamais capturé à l'import : un module chargé pendant
 * un rendu serveur resterait sinon coincé sur la source qu'il a trouvée la
 * première fois, y compris une fois revenu dans le navigateur.
 */
function repository(): EmployeeRepository {
  if (supabaseConfigured() && typeof window !== "undefined") {
    return createSupabaseEmployeeRepository(createSupabaseBrowserClient())
  }
  return createEmployeeRepository(browserStore())
}

export const employeeService: EmployeeRepository = {
  list: () => repository().list(),
  getById: (id) => repository().getById(id),
  create: (draft) => repository().create(draft),
  update: (id, draft) => repository().update(id, draft),
  disable: (id) => repository().disable(id),
  remove: (id) => repository().remove(id),
  setScheduleType: (id, scheduleType) => repository().setScheduleType(id, scheduleType),
  setSectors: (id, sectors) => repository().setSectors(id, sectors),
}

export { normalizeContract }
