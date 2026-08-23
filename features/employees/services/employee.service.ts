import { browserStore } from "@/features/core/shared/key-value-store"
import {
  createEmployeeRepository,
  normalizeContract,
} from "@/features/employees/persistence/employee.repository"
import type { EmployeeRepository } from "@/features/employees/persistence/employee.repository"

/**
 * Le dépôt des salariés, lié au navigateur.
 *
 * Toute la logique vit désormais dans `employee.repository.ts`, qui reçoit son
 * stockage. Ce fichier n'est plus qu'une liaison : il dit *où* les fiches sont
 * rangées, pas *comment* elles se lisent.
 *
 * Il reste parce que neuf appelants le nomment. Les débrancher est le travail
 * des écrans, pas celui-ci — et les mêler aurait rendu impossible de dire, en
 * cas de régression, laquelle des deux transformations l'a causée.
 *
 * Le stockage est résolu à chaque appel, jamais capturé à l'import : un rendu
 * serveur trouverait alors l'oubli et le garderait pour toute la vie du module,
 * y compris une fois revenu dans le navigateur.
 */
function repository(): EmployeeRepository {
  return createEmployeeRepository(browserStore())
}

export const employeeService: EmployeeRepository = {
  list: () => repository().list(),
  getById: (id) => repository().getById(id),
  create: (draft) => repository().create(draft),
  update: (id, draft) => repository().update(id, draft),
  disable: (id) => repository().disable(id),
  setScheduleType: (id, scheduleType) => repository().setScheduleType(id, scheduleType),
}

export { normalizeContract }
