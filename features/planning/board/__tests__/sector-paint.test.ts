import { describe, expect, it } from "vitest"

import { sectorBarPaint, sectorBarTitle, sectorBarsOf } from "@/features/planning/board/model/sector-paint"

const plain = { opens: false, closes: false }

describe("peinture d'une barre de rayon", () => {
  it("prend la couleur réglée pour le rayon", () => {
    const paint = sectorBarPaint("#2563eb", plain)
    expect(paint?.backgroundColor).toBe("rgba(37, 99, 235, 0.16)")
    expect(paint?.borderColor).toBe("rgba(37, 99, 235, 0.55)")
  })

  it("assombrit le texte plutôt que d'écrire la teinte sur elle-même", () => {
    // Un rayon jaune sur son propre fond pâle ne se lirait pas.
    const paint = sectorBarPaint("#facc15", plain)
    expect(paint?.color).toBe("#705c09")
  })

  it("ombre la GAUCHE quand la barre ouvre le rayon", () => {
    const paint = sectorBarPaint("#2563eb", { opens: true, closes: false })
    expect(paint?.backgroundImage).toBe(
      "linear-gradient(to right, rgba(37, 99, 235, 0.5), rgba(37, 99, 235, 0) 28%)"
    )
  })

  it("ombre la DROITE quand elle ferme", () => {
    const paint = sectorBarPaint("#2563eb", { opens: false, closes: true })
    expect(paint?.backgroundImage).toBe(
      "linear-gradient(to left, rgba(37, 99, 235, 0.5), rgba(37, 99, 235, 0) 28%)"
    )
  })

  it("ombre les DEUX bords quand la même personne ouvre et ferme", () => {
    const paint = sectorBarPaint("#2563eb", { opens: true, closes: true })
    expect(paint?.backgroundImage).toContain("to right")
    expect(paint?.backgroundImage).toContain("to left")
  })

  it("n'ombre rien pour une barre ordinaire", () => {
    expect(sectorBarPaint("#2563eb", plain)?.backgroundImage).toBeUndefined()
  })

  it("accepte la forme courte et se passe du dièse", () => {
    expect(sectorBarPaint("#28f", plain)?.backgroundColor).toBe("rgba(34, 136, 255, 0.16)")
    expect(sectorBarPaint("2563eb", plain)?.backgroundColor).toBe("rgba(37, 99, 235, 0.16)")
  })

  it("rend null plutôt que d'inventer une couleur", () => {
    // `null` dit à l'appelant de garder son habillage de secours ; une couleur
    // inventée ferait croire à un réglage que personne n'a fait.
    for (const value of [null, undefined, "", "bleu", "#12345", "#gggggg"]) {
      expect(sectorBarPaint(value, plain)).toBeNull()
    }
  })
})

describe("infobulle d'une barre", () => {
  const base = { kindLabel: "Journée", label: "06:30 – 14:30", durationLabel: "8h", locked: false }

  it("dit le rayon, puis le rôle, puis l'horaire", () => {
    expect(sectorBarTitle({ ...base, sectorName: "Charcuterie", role: { opens: true, closes: false } }))
      .toBe("Charcuterie · ouvre · 06:30 – 14:30 · 8h")
  })

  it("dit les deux rôles quand la même personne ouvre et ferme", () => {
    expect(sectorBarTitle({ ...base, sectorName: "Poisson", role: { opens: true, closes: true } }))
      .toBe("Poisson · ouvre et ferme · 06:30 – 14:30 · 8h")
  })

  it("se tait sur le rôle quand il n'y en a pas", () => {
    expect(sectorBarTitle({ ...base, sectorName: "PVP", role: { opens: false, closes: false } }))
      .toBe("PVP · 06:30 – 14:30 · 8h")
  })

  it("retombe sur le type de journée sans rayon, et signale le verrou", () => {
    expect(sectorBarTitle({ ...base, role: { opens: false, closes: false }, locked: true }))
      .toBe("Journée · 06:30 – 14:30 · 8h · verrouillé")
  })
})

describe("une barre par rayon servi", () => {
  const block = (
    sectorName: string,
    color: string | null,
    role: { opens: boolean; closes: boolean }
  ) => ({
    sectorId: sectorName.toLowerCase(),
    sectorName,
    color,
    ...role,
    startLabel: "06:00",
    endLabel: "09:00",
    durationLabel: "3h",
  })
  const shift = {
    startLabel: "06:00", endLabel: "14:00", durationLabel: "8h",
    kindLabel: "Journée", opensDay: true, closesDay: false,
  }

  it("découpe une journée à cheval sur deux comptoirs", () => {
    // C'est ce que la grille de la semaine cachait : une seule barre, sans nom
    // de rayon, pour quelqu'un qui passe de l'un à l'autre.
    const bars = sectorBarsOf({
      ...shift,
      sectorBlocks: [
        block("Fromage", "#facc15", { opens: true, closes: true }),
        block("Charcuterie", "#2563eb", { opens: false, closes: false }),
      ],
    })

    expect(bars).toHaveLength(2)
    expect(bars.map((bar) => bar.sectorName)).toEqual(["Fromage", "Charcuterie"])
    expect(bars[0].title).toBe("Fromage · ouvre et ferme · 06:00 – 09:00 · 3h")
    // La teinte vient du rayon, l'ombrage du rôle.
    expect(bars[0].paint?.backgroundColor).toBe("rgba(250, 204, 21, 0.16)")
    expect(bars[0].paint?.backgroundImage).toContain("to right")
    expect(bars[1].paint?.backgroundImage).toBeUndefined()
  })

  it("laisse une journée sans affectation en une seule barre", () => {
    const bars = sectorBarsOf({ ...shift, sectorBlocks: [] })
    expect(bars).toHaveLength(1)
    expect(bars[0].sectorName).toBeNull()
    expect(bars[0].paint).toBeNull()
    expect(bars[0].durationLabel).toBe("8h")
  })

  it("garde son habillage de secours quand le rayon n'a pas de couleur", () => {
    const bars = sectorBarsOf({
      ...shift,
      sectorBlocks: [block("PVP", null, { opens: false, closes: true })],
    })
    expect(bars[0].paint).toBeNull()
    expect(bars[0].sectorName).toBe("PVP")
  })
})
