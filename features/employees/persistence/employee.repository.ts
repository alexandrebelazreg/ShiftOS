import type { KeyValueStore } from "@/features/core/shared/key-value-store"
import { WEEK_DAYS } from "@/features/core/models"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import type {
  EmployeeRecord,
  EmployeeScheduleType,
} from "@/features/employees/types/employee.types"

const EMPLOYEES_KEY = "shiftos_employees"

/**
 * Les fiches salariés, derrière une interface qui ne dit pas où elles vivent.
 *
 * Extrait du service qui allait chercher `window.localStorage` lui-même. Le
 * comportement est le même à la virgule près ; ce qui change est qu'on peut
 * désormais lui passer autre chose — un stockage en mémoire pour un test, une
 * base pour la suite. C'était la condition pour que la mise en base ne se
 * heurte pas deux fois à ce module.
 *
 * Un salarié se DÉSACTIVE : retirer sa fiche emporterait l'histoire des
 * plannings qui la citent, et rendrait illisible un planning de l'an dernier.
 * C'est pour cela que `disable` est le geste ordinaire, et le seul que
 * l'écran propose sur une fiche qui a servi.
 *
 * `remove` existe pour le seul cas que cette règle punissait injustement : la
 * fiche créée à l'instant avec une faute de frappe, que rien ne cite encore et
 * qu'on gardait pourtant à vie. Le dépôt ne juge pas — il exécute. C'est
 * `employeeDeletionVerdict` qui cherche les citations, et l'appelant qui doit
 * l'avoir consulté : la base ne peut pas servir de garde-fou, puisque
 * `absences.employee_id` porte `on delete cascade` et emporterait les absences
 * sans un mot.
 */
export interface EmployeeRepository {
  list(): Promise<EmployeeRecord[]>
  getById(id: string): Promise<EmployeeRecord | null>
  create(draft: EmployeeDraft): Promise<EmployeeRecord>
  update(id: string, draft: EmployeeDraft): Promise<EmployeeRecord>
  disable(id: string): Promise<EmployeeRecord>
  /** Efface la fiche. À n'appeler qu'après un verdict de suppression favorable. */
  remove(id: string): Promise<void>
  setScheduleType(id: string, scheduleType: EmployeeScheduleType): Promise<EmployeeRecord>
  /**
   * Réécrit les seuls secteurs, sans repasser par `update`.
   *
   * `update` redérive les jours travaillés depuis les repos fixes et renormalise
   * le contrat : légitime quand un formulaire a été soumis, dangereux quand on
   * ne fait que suivre un secteur renommé. Une opération étroite ne peut pas
   * emporter un champ qu'on ne voulait pas toucher.
   */
  setSectors(id: string, sectors: readonly string[]): Promise<EmployeeRecord>
}

export interface EmployeeRepositoryOptions {
  /** Horloge, injectable pour des tests déterministes. */
  readonly now?: () => string
  /** Générateur d'identifiants, injectable pour la même raison. */
  readonly generateId?: () => string
}

export function createEmployeeRepository(
  store: KeyValueStore,
  options: EmployeeRepositoryOptions = {}
): EmployeeRepository {
  const now = options.now ?? (() => new Date().toISOString())
  const generateId = options.generateId ?? (() => `emp_${Math.random().toString(36).slice(2, 10)}`)

  // Relu à chaque appel plutôt que gardé en mémoire.
  //
  // L'ancien service hydratait une fois puis servait un tableau de module. À
  // une fenêtre près le résultat est identique — personne d'autre n'écrit sous
  // cette clé — mais un cache de module survit aux tests, se partage entre deux
  // dépôts et n'a aucun sens le jour où la source est une base. Sur cinq fiches,
  // relire coûte moins que le raisonnement qu'un cache impose.
  function readAll(): EmployeeRecord[] {
    try {
      const value: unknown = JSON.parse(store.getItem(EMPLOYEES_KEY) ?? "[]")
      if (!Array.isArray(value)) return []
      return (value as EmployeeRecord[]).map(normalizeContract)
    } catch {
      return []
    }
  }

  function writeAll(employees: readonly EmployeeRecord[]): void {
    store.setItem(EMPLOYEES_KEY, JSON.stringify(employees))
  }

  function replace(
    id: string,
    change: (employee: EmployeeRecord) => EmployeeRecord
  ): EmployeeRecord {
    const employees = readAll()
    const index = employees.findIndex((employee) => employee.id === id)
    if (index === -1) throw new Error(`Employee not found: ${id}`)
    const updated = change(employees[index])
    writeAll(employees.map((employee, current) => (current === index ? updated : employee)))
    return { ...updated }
  }

  return {
    async list() {
      return readAll().map((employee) => ({ ...employee }))
    },

    async getById(id) {
      const found = readAll().find((employee) => employee.id === id)
      return found ? { ...found } : null
    },

    async create(draft) {
      const timestamp = now()
      const employee: EmployeeRecord = {
        ...draft,
        schemaVersion: 2,
        weeklyMinutes: draft.weeklyMinutes ?? Math.round(draft.weeklyHours * 60),
        contractMinuteConfirmationRequired: false,
        scheduleType: draft.scheduleType ?? "variable",
        student: draft.student ?? false,
        forfaitJour: draft.forfaitJour ?? false,
        workingDays: WEEK_DAYS.filter((day) => !draft.fixedDaysOff.includes(day)),
        id: generateId(),
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      writeAll([employee, ...readAll()])
      return { ...employee }
    },

    async update(id, draft) {
      return replace(id, (previous) => ({
        ...previous,
        ...draft,
        schemaVersion: 2,
        weeklyMinutes: draft.weeklyMinutes ?? Math.round(draft.weeklyHours * 60),
        contractMinuteConfirmationRequired: false,
        scheduleType: draft.scheduleType ?? previous.scheduleType ?? "variable",
        student: draft.student ?? previous.student ?? false,
        forfaitJour: draft.forfaitJour ?? previous.forfaitJour ?? false,
        workingDays: WEEK_DAYS.filter((day) => !draft.fixedDaysOff.includes(day)),
        id,
        updatedAt: now(),
      }))
    },

    async disable(id) {
      return replace(id, (previous) => ({
        ...previous,
        status: "inactive",
        updatedAt: now(),
      }))
    },

    async remove(id) {
      const employees = readAll()
      if (!employees.some((employee) => employee.id === id)) {
        throw new Error(`Employee not found: ${id}`)
      }
      writeAll(employees.filter((employee) => employee.id !== id))
    },

    async setScheduleType(id, scheduleType) {
      return replace(id, (previous) => ({ ...previous, scheduleType, updatedAt: now() }))
    },

    async setSectors(id, sectors) {
      return replace(id, (previous) => ({ ...previous, sectors: [...sectors], updatedAt: now() }))
    },
  }
}

/**
 * Remet une fiche au format courant.
 *
 * Appliqué à la LECTURE, pas à l'écriture : une fiche enregistrée avant que les
 * minutes existent doit se relire correctement sans qu'on ait à réécrire toute
 * la base. Le cas `36.5` est le seul qui refuse de se deviner — c'est la valeur
 * qu'un contrat de 36 h 30 produisait autrefois, et la lire comme 36,5 heures
 * inventerait trente secondes par semaine. Elle est marquée à confirmer.
 */
export function normalizeContract(employee: EmployeeRecord): EmployeeRecord {
  const scheduleType = employee.scheduleType ?? "variable"
  if (typeof employee.weeklyMinutes === "number") {
    return {
      ...employee,
      scheduleType,
      schemaVersion: 2,
      weeklyHours: employee.weeklyMinutes / 60,
      contractMinuteConfirmationRequired: false,
    }
  }
  if (employee.weeklyHours === 36.5) {
    return {
      ...employee,
      scheduleType,
      schemaVersion: 1,
      weeklyMinutes: null,
      contractMinuteConfirmationRequired: true,
    }
  }
  const weeklyMinutes = Math.round(employee.weeklyHours * 60)
  return {
    ...employee,
    scheduleType,
    schemaVersion: 2,
    weeklyMinutes,
    weeklyHours: weeklyMinutes / 60,
    contractMinuteConfirmationRequired: false,
  }
}
