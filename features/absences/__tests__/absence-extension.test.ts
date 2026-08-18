import { beforeEach, describe, expect, it, vi } from "vitest"

import { absenceService } from "@/features/absences/services/absence.service"

/**
 * La prolongation — ce qui remplace la « fin inconnue ».
 *
 * On n'ignore jamais la date de fin : le papier la porte. Ce qu'on ignore, c'est
 * s'il y en aura un second. L'arrêt est donc enregistré avec sa date, et le jour
 * où la prolongation arrive, on repousse cette date ici.
 *
 * Un stockage en mémoire fait tenir le service sans navigateur ; c'est le seul
 * moyen d'éprouver l'écriture, que le rendu HTML ne montre pas.
 */
function installStorage() {
  const values = new Map<string, string>()
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  })
}

const draft = {
  employeeId: "1",
  type: "sick_leave",
  start: "2026-03-09",
  end: "2026-03-13",
}

describe("prolonger une absence", () => {
  beforeEach(() => {
    installStorage()
  })

  it("repousse la fin et garde l'étape", () => {
    return (async () => {
      const created = await absenceService.create(draft, "2026-03-09")
      const extended = await absenceService.extend(created.id, "2026-03-20", "2026-03-12")

      expect(extended?.end).toBe("2026-03-20")
      expect(extended?.extensions).toEqual([
        { previousEnd: "2026-03-13", newEnd: "2026-03-20", recordedOn: "2026-03-12" },
      ])
    })()
  })

  it("empile les prolongations successives, sans les confondre", async () => {
    // Un arrêt de quinze jours et trois arrêts de cinq jours bout à bout ne se
    // valent ni pour la paie ni pour la prévoyance : seule la suite des étapes
    // permet encore de dire laquelle des deux on a vécue.
    const created = await absenceService.create(draft, "2026-03-09")
    await absenceService.extend(created.id, "2026-03-20", "2026-03-12")
    const twice = await absenceService.extend(created.id, "2026-03-27", "2026-03-19")

    expect(twice?.end).toBe("2026-03-27")
    expect(twice?.extensions).toHaveLength(2)
    expect(twice?.extensions?.[1]).toEqual({
      previousEnd: "2026-03-20",
      newEnd: "2026-03-27",
      recordedOn: "2026-03-19",
    })
  })

  it("se relit depuis le stockage, prolongations comprises", async () => {
    const created = await absenceService.create(draft, "2026-03-09")
    await absenceService.extend(created.id, "2026-03-20", "2026-03-12")

    const [reread] = await absenceService.list()
    expect(reread.end).toBe("2026-03-20")
    expect(reread.extensions).toHaveLength(1)
  })

  it("ne prolonge rien qui n'existe pas", async () => {
    expect(await absenceService.extend("inconnu", "2026-03-20", "2026-03-12")).toBeNull()
  })
})
