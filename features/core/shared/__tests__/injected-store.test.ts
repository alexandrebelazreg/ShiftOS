import { describe, expect, it } from "vitest"

import { browserStore, memoryStore, nullStore } from "@/features/core/shared/key-value-store"
import { createAbsenceRepository } from "@/features/absences/persistence/absence.repository"
import { createEmployeeRepository } from "@/features/employees/persistence/employee.repository"
import type { AbsenceType } from "@/features/core/models"

/**
 * La propriété que la phase 4 existe pour obtenir : ces deux dépôts travaillent
 * sur le stockage qu'on leur donne.
 *
 * Ce n'était pas vrai avant. Les deux allaient chercher `window.localStorage`
 * eux-mêmes, et leurs tests s'appuyaient sans le savoir sur un tableau de module
 * — sans fenêtre, rien n'était écrit et le service relisait sa propre mémoire.
 * Un serveur aurait accumulé les fiches d'une requête à l'autre.
 *
 * Ce fichier tourne SANS `window`. S'il passe, la source de données est
 * réellement remplaçable — et Postgres pourra prendre la place de `localStorage`
 * sans qu'un appelant change.
 */

const draft = {
  firstName: "Ines",
  lastName: "Roy",
  phone: "",
  email: "",
  status: "active" as const,
  weeklyHours: 30,
  contractType: "part_time" as const,
  sectors: [],
  competencies: {},
  canOpen: true,
  canClose: true,
  splitShiftAllowed: false,
  fixedDaysOff: ["sunday" as const],
  forbiddenDays: [],
  maxOpenings: null,
  maxClosings: null,
  preferOpening: false,
  preferClosing: false,
  notes: "",
}

describe("les dépôts travaillent sur le stockage qu'on leur donne", () => {
  it("n'a besoin d'aucune fenêtre", () => {
    expect(typeof window).toBe("undefined")
  })

  it("écrit une fiche salarié dans le stockage fourni, et l'y relit", async () => {
    const store = memoryStore()
    const repository = createEmployeeRepository(store, {
      now: () => "2026-01-01T00:00:00.000Z",
      generateId: () => "emp_test",
    })

    await repository.create(draft)

    // Relu par un SECOND dépôt sur le même stockage : la fiche est bien dans le
    // stockage, pas dans la mémoire de l'objet qui l'a écrite. C'est toute la
    // différence avec ce qui existait avant.
    const relecture = createEmployeeRepository(store)
    const fiches = await relecture.list()
    expect(fiches).toHaveLength(1)
    expect(fiches[0].id).toBe("emp_test")
    expect(fiches[0].weeklyMinutes).toBe(1800)
  })

  it("garde les deux dépôts étanches l'un à l'autre", async () => {
    const premier = createEmployeeRepository(memoryStore())
    const second = createEmployeeRepository(memoryStore())

    await premier.create(draft)

    expect(await premier.list()).toHaveLength(1)
    expect(await second.list()).toHaveLength(0)
  })

  it("enregistre une absence, la prolonge, et garde l'étape", async () => {
    const store = memoryStore()
    const repository = createAbsenceRepository(store, { generateId: () => "abs_test" })

    await repository.create(
      {
        employeeId: "emp_test",
        type: "sick_leave" as AbsenceType,
        start: "2026-03-09",
        end: "2026-03-13",
      },
      "2026-03-09"
    )
    await repository.extend("abs_test", "2026-03-20", "2026-03-12")

    const [absence] = await createAbsenceRepository(store).list()
    expect(absence.end).toBe("2026-03-20")
    expect(absence.extensions).toHaveLength(1)
    expect(absence.extensions?.[0].previousEnd).toBe("2026-03-13")
  })

  it("n'écrit nulle part quand il n'y a pas de fenêtre, sans lever", async () => {
    // `browserStore` rend l'oubli hors navigateur. Un écran rendu côté serveur
    // doit traverser son code de chargement sans exploser — et n'a de toute
    // façon rien à persister.
    expect(browserStore().getItem("shiftos_employees")).toBeNull()

    const repository = createEmployeeRepository(nullStore())
    await repository.create(draft)
    expect(await repository.list()).toHaveLength(0)
  })
})
