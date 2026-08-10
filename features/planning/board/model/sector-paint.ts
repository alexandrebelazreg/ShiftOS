/**
 * De la couleur d'un rayon aux styles d'une barre du planning.
 *
 * Pourquoi ce n'est pas une classe Tailwind : la couleur d'un rayon est saisie
 * par le gérant, donc arbitraire. Aucune classe ne peut être générée à la
 * compilation pour un hex inconnu, et une palette de secours tirée d'un hachage
 * donnait deux rayons de la même teinte sans rapport avec ce que le gérant a
 * choisi. On calcule donc les couleurs, et on le fait ici — en pur, sans React,
 * pour que la règle soit vérifiable.
 *
 * Ce que la barre doit dire, dans cet ordre :
 *
 * 1. **DE QUEL RAYON il s'agit** — c'est la teinte. Une couleur par rayon, celle
 *    que le gérant a réglée, la même partout dans l'application.
 * 2. **s'il ouvre ou ferme** — c'est un ombrage de bord, à gauche pour
 *    l'ouverture, à droite pour la fermeture.
 *
 * La teinte portait auparavant le RÔLE (vert on ouvre, violet on ferme, bleu
 * entre les deux). Un planning multi-rayons devenait alors illisible : trois
 * couleurs pour cinq comptoirs, et rien ne disait qui allait où. Le rôle est une
 * information de bord — il concerne les extrémités de la barre — donc il est
 * rendu aux extrémités.
 */

export interface SectorBarPaint {
  readonly backgroundColor: string
  readonly borderColor: string
  readonly color: string
  /** Les ombrages de bord. Absent quand la barre n'ouvre ni ne ferme. */
  readonly backgroundImage?: string
}

export interface SectorBarRole {
  readonly opens: boolean
  readonly closes: boolean
}

/** Fraction de la largeur sur laquelle l'ombrage s'estompe. */
const SHADE_WIDTH = "28%"

/**
 * Les styles d'une barre, ou `null` quand le rayon n'a pas de couleur lisible.
 *
 * `null` n'est pas un échec : c'est le signal que l'appelant doit garder son
 * habillage de secours. Inventer une couleur pour un rayon qui n'en déclare pas
 * ferait croire à un réglage que personne n'a fait.
 */
export function sectorBarPaint(
  color: string | null | undefined,
  role: SectorBarRole
): SectorBarPaint | null {
  const rgb = parseHex(color)
  if (rgb === null) return null

  const shades: string[] = []
  // L'ouverture à gauche, la fermeture à droite : le bord ombré est le bord où
  // la responsabilité se tient réellement dans la journée.
  if (role.opens) shades.push(`linear-gradient(to right, ${rgba(rgb, 0.5)}, ${rgba(rgb, 0)} ${SHADE_WIDTH})`)
  if (role.closes) shades.push(`linear-gradient(to left, ${rgba(rgb, 0.5)}, ${rgba(rgb, 0)} ${SHADE_WIDTH})`)

  return {
    backgroundColor: rgba(rgb, 0.16),
    borderColor: rgba(rgb, 0.55),
    // Le texte est la teinte assombrie, jamais la teinte brute : un rayon jaune
    // sur son propre fond pâle ne se lit pas.
    color: hex(darken(rgb, 0.55)),
    ...(shades.length > 0 ? { backgroundImage: shades.join(", ") } : {}),
  }
}

/**
 * L'infobulle d'une barre : le rayon, le rôle, l'horaire — dans cet ordre.
 *
 * Ici et pas dans le composant, parce que le board interdit toute logique à ses
 * composants React et qu'une règle de composition en est une. Ici, elle se teste.
 */
export function sectorBarTitle(input: {
  readonly sectorName?: string
  readonly kindLabel: string
  readonly role: SectorBarRole
  readonly label: string
  readonly durationLabel: string
  readonly locked: boolean
}): string {
  const roles: string[] = []
  if (input.role.opens) roles.push("ouvre")
  if (input.role.closes) roles.push("ferme")

  const parts: string[] = [input.sectorName ?? input.kindLabel]
  if (roles.length > 0) parts.push(roles.join(" et "))
  parts.push(input.label, input.durationLabel)
  if (input.locked) parts.push("verrouillé")
  return parts.join(" · ")
}

/** Une barre à dessiner : un rayon servi, ou la journée entière à défaut. */
export interface SectorBar {
  readonly key: string
  /** `null` hors zone marché : il n'y a alors qu'un rayon, le nommer est du bruit. */
  readonly sectorName: string | null
  readonly startLabel: string
  readonly endLabel: string
  readonly durationLabel: string
  readonly paint: SectorBarPaint | null
  readonly title: string
}

interface ShiftLike {
  readonly startLabel: string
  readonly endLabel: string
  readonly durationLabel: string
  readonly kindLabel: string
  readonly opensDay: boolean
  readonly closesDay: boolean
  readonly sectorBlocks: readonly {
    readonly sectorId: string
    readonly sectorName: string
    readonly color: string | null
    readonly opens: boolean
    readonly closes: boolean
    readonly startLabel: string
    readonly endLabel: string
    readonly durationLabel: string
  }[]
}

/**
 * Une journée de travail → une barre PAR RAYON servi.
 *
 * La grille de la semaine n'en dessinait qu'une par personne, coloriée par le
 * rôle et sans le nom du comptoir. Quelqu'un qui passe de la charcuterie au
 * poisson dans la même journée y apparaissait comme un bloc unique : l'écran
 * qu'on regarde en premier cachait exactement ce qu'on venait y chercher.
 *
 * Sans affectation par rayon — mono-rayon, ou données anciennes — la journée
 * reste une seule barre et rien ne change pour elle.
 */
export function sectorBarsOf(shift: ShiftLike): readonly SectorBar[] {
  if (shift.sectorBlocks.length === 0) {
    return [{
      key: "day",
      sectorName: null,
      startLabel: shift.startLabel,
      endLabel: shift.endLabel,
      durationLabel: shift.durationLabel,
      paint: null,
      title: sectorBarTitle({
        kindLabel: shift.kindLabel,
        role: { opens: shift.opensDay, closes: shift.closesDay },
        label: `${shift.startLabel} – ${shift.endLabel}`,
        durationLabel: shift.durationLabel,
        locked: false,
      }),
    }]
  }

  return shift.sectorBlocks.map((block, index) => ({
    key: `${block.sectorId}-${index}`,
    sectorName: block.sectorName,
    startLabel: block.startLabel,
    endLabel: block.endLabel,
    durationLabel: block.durationLabel,
    paint: sectorBarPaint(block.color, block),
    title: sectorBarTitle({
      sectorName: block.sectorName,
      kindLabel: shift.kindLabel,
      role: block,
      label: `${block.startLabel} – ${block.endLabel}`,
      durationLabel: block.durationLabel,
      locked: false,
    }),
  }))
}

interface Rgb {
  readonly red: number
  readonly green: number
  readonly blue: number
}

/** `#rgb` ou `#rrggbb`, avec ou sans dièse. Tout le reste vaut `null`. */
function parseHex(value: string | null | undefined): Rgb | null {
  if (typeof value !== "string") return null
  const digits = value.trim().replace(/^#/, "")
  const full =
    digits.length === 3
      ? digits.split("").map((digit) => digit + digit).join("")
      : digits
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return {
    red: Number.parseInt(full.slice(0, 2), 16),
    green: Number.parseInt(full.slice(2, 4), 16),
    blue: Number.parseInt(full.slice(4, 6), 16),
  }
}

function rgba({ red, green, blue }: Rgb, alpha: number): string {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function darken({ red, green, blue }: Rgb, amount: number): Rgb {
  const mix = (channel: number) => Math.round(channel * (1 - amount))
  return { red: mix(red), green: mix(green), blue: mix(blue) }
}

function hex({ red, green, blue }: Rgb): string {
  const pair = (channel: number) => channel.toString(16).padStart(2, "0")
  return `#${pair(red)}${pair(green)}${pair(blue)}`
}
