import { describe, expect, it } from "vitest"

import { signPrintedLabel } from "@/features/core/shared/print-signature"

/**
 * Le pied de page d'une feuille affichée au mur.
 *
 * Ce qui se teste ici est le REPLI, pas la concaténation. Un nom absent ne doit
 * produire ni « par », ni « par null », ni un espace traînant : la feuille doit
 * se lire exactement comme avant, comme si la signature n'existait pas. Un
 * magasin dont personne n'a rempli son nom ne doit rien remarquer.
 *
 * C'est le genre de détail qu'on ne voit ni au typage ni à l'écran — on le
 * découvre imprimé sur trente exemplaires punaisés en réserve.
 */
describe("signPrintedLabel", () => {
  const base = "Édité le 27/08/2026 à 09:12"

  it("ajoute le nom quand il y en a un", () => {
    expect(signPrintedLabel(base, "Alexandre Belazreg")).toBe(
      "Édité le 27/08/2026 à 09:12 par Alexandre Belazreg"
    )
  })

  it("ne laisse aucune trace quand personne n'a signé", () => {
    for (const nobody of [null, undefined, "", "   "]) {
      expect(signPrintedLabel(base, nobody)).toBe(base)
    }
  })

  it("n'imprime pas les espaces d'un nom mal collé", () => {
    expect(signPrintedLabel(base, "  Alexandre Belazreg  ")).toBe(
      "Édité le 27/08/2026 à 09:12 par Alexandre Belazreg"
    )
  })

  /** Les autres feuilles n'ont pas le même début de phrase, et s'en moquent. */
  it("signe n'importe quel libellé, pas seulement « Édité le »", () => {
    expect(signPrintedLabel("Imprimé le 27 août 2026", "Camille Roy")).toBe(
      "Imprimé le 27 août 2026 par Camille Roy"
    )
  })
})
