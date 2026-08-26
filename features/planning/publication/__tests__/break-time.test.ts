import { describe, expect, it } from "vitest"

import {
  breakLabel,
  breakMinutes,
  durationWithBreak,
} from "@/features/planning/publication/model/break-time"

/**
 * Trois minutes par heure, au prorata.
 *
 * Ce qui se teste ici est le PRORATA, pas la multiplication. Une vacation ne
 * dure presque jamais un nombre entier d'heures ; calculer sur les heures
 * pleines coûterait un quart d'heure de pause sur une semaine, et personne ne
 * s'en apercevrait en relisant la feuille.
 */
describe("breakMinutes", () => {
  it("donne trois minutes pour une heure pleine", () => {
    expect(breakMinutes(60)).toBe(3)
    expect(breakMinutes(8 * 60)).toBe(24)
  })

  it("compte les minutes entamées, pas les heures pleines", () => {
    // 7h45 = 465 min → 23,25 → 23. Sur les heures pleines on aurait dit 21.
    expect(breakMinutes(7 * 60 + 45)).toBe(23)
    expect(breakMinutes(4 * 60 + 15)).toBe(13)
    expect(breakMinutes(5 * 60 + 45)).toBe(17)
  })

  it("rend zéro pour une vacation vide ou absurde", () => {
    expect(breakMinutes(0)).toBe(0)
    expect(breakMinutes(-30)).toBe(0)
  })
})

describe("durationWithBreak", () => {
  it("écrit la pause entre parenthèses, derrière la durée", () => {
    expect(durationWithBreak("7h45", 7 * 60 + 45)).toBe("7h45 (23 min)")
  })

  /**
   * Jamais « (0 min) » : une parenthèse vide laisserait croire à une pause
   * supprimée, là où il n'y a simplement rien à prendre.
   */
  it("laisse la durée seule quand il n'y a pas de quoi faire une minute", () => {
    expect(durationWithBreak("0h", 0)).toBe("0h")
    expect(breakLabel(0)).toBeNull()
    // Neuf minutes travaillées ouvrent 0,45 min, arrondi à zéro.
    expect(durationWithBreak("9min", 9)).toBe("9min")
  })

  it("arrondit à la minute la plus proche, jamais en dessous", () => {
    // 10 min → 0,5 → 1 (arrondi au supérieur à la moitié).
    expect(breakMinutes(10)).toBe(1)
    expect(breakMinutes(30)).toBe(2)
  })
})
