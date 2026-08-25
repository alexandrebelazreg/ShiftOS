import { describe, expect, it } from "vitest"

import {
  clientIp,
  LoginThrottle,
  loginLimits,
  MAX_PER_EMAIL,
  MAX_PER_IP,
  tooManyAttemptsMessage,
  WINDOW_MS,
} from "@/features/auth/login-throttle"

const T0 = 1_800_000_000_000

/** Une limite isolée, pour éprouver le compteur sans le couple adresse/IP. */
const seule = [{ key: "essai", max: 3 }]

describe("le compteur d'échecs", () => {
  it("laisse passer tant que le plafond n'est pas atteint", () => {
    const throttle = new LoginThrottle()

    throttle.recordFailure(seule, T0)
    throttle.recordFailure(seule, T0 + 1000)

    expect(throttle.retryAfterMs(seule, T0 + 2000)).toBe(0)
  })

  it("retient dès que le plafond est atteint", () => {
    const throttle = new LoginThrottle()

    for (let i = 0; i < 3; i += 1) throttle.recordFailure(seule, T0 + i)

    expect(throttle.retryAfterMs(seule, T0 + 10)).toBeGreaterThan(0)
  })

  it("libère quand le plus ancien échec sort de la fenêtre", () => {
    const throttle = new LoginThrottle()

    for (let i = 0; i < 3; i += 1) throttle.recordFailure(seule, T0 + i)

    // La fenêtre est ouverte à droite, fermée à gauche : un échec posé en T0
    // compte tant que l'instant présent est STRICTEMENT avant T0 + WINDOW_MS.
    expect(throttle.retryAfterMs(seule, T0 + WINDOW_MS - 1)).toBeGreaterThan(0)
    // À l'instant exact, il sort, et le compteur repasse à deux.
    expect(throttle.retryAfterMs(seule, T0 + WINDOW_MS)).toBe(0)
  })

  /**
   * Le cas qui distingue une fenêtre glissante d'un verrou.
   *
   * Cinq échecs pour un plafond de trois : voir le premier expirer ne suffit
   * pas, il en reste quatre. Un compteur qui ne regarderait que le plus ancien
   * rouvrirait ici avec deux échecs de trop.
   */
  it("attend qu'il en sorte ASSEZ, pas seulement un", () => {
    const throttle = new LoginThrottle()

    for (let i = 0; i < 5; i += 1) throttle.recordFailure(seule, T0 + i * 1000)

    // Le premier vient de sortir : quatre restent, toujours au-dessus de trois.
    expect(throttle.retryAfterMs(seule, T0 + WINDOW_MS + 1)).toBeGreaterThan(0)
    // Le troisième sorti : il n'en reste que deux.
    expect(throttle.retryAfterMs(seule, T0 + 2000 + WINDOW_MS + 1)).toBe(0)
  })

  it("efface le passé sur demande", () => {
    const throttle = new LoginThrottle()

    for (let i = 0; i < 3; i += 1) throttle.recordFailure(seule, T0 + i)
    throttle.forget(seule)

    expect(throttle.retryAfterMs(seule, T0 + 10)).toBe(0)
  })

  it("rend le plus long des délais quand deux limites retiennent", () => {
    const throttle = new LoginThrottle()
    const courte = { key: "courte", max: 1 }
    const longue = { key: "longue", max: 1 }

    throttle.recordFailure([courte], T0)
    throttle.recordFailure([longue], T0 + 60_000)

    const wait = throttle.retryAfterMs([courte, longue], T0 + 60_000)

    // Celui qui a commencé le plus tard est celui qui libère le plus tard.
    expect(wait).toBe(WINDOW_MS)
  })

  it("compte séparément deux clés distinctes", () => {
    const throttle = new LoginThrottle()
    const a = [{ key: "a", max: 1 }]
    const b = [{ key: "b", max: 1 }]

    throttle.recordFailure(a, T0)

    expect(throttle.retryAfterMs(a, T0)).toBeGreaterThan(0)
    expect(throttle.retryAfterMs(b, T0)).toBe(0)
  })
})

describe("les clés d'une tentative", () => {
  it("porte un plafond par adresse et un autre, plus haut, par IP", () => {
    const limits = loginLimits("gerant@magasin.fr", "203.0.113.7")

    expect(limits.map((limit) => limit.max)).toEqual([MAX_PER_EMAIL, MAX_PER_IP])
    expect(MAX_PER_IP).toBeGreaterThan(MAX_PER_EMAIL)
  })

  it("ignore la casse de l'adresse", () => {
    const [minuscules] = loginLimits("Gerant@Magasin.FR", "203.0.113.7")
    const [identique] = loginLimits("gerant@magasin.fr", "203.0.113.7")

    // Sans cela, alterner la casse doublerait le nombre d'essais offerts.
    expect(minuscules.key).toBe(identique.key)
  })

  it("sépare deux adresses sur une même IP", () => {
    const [premier] = loginLimits("un@magasin.fr", "203.0.113.7")
    const [second] = loginLimits("deux@magasin.fr", "203.0.113.7")

    expect(premier.key).not.toBe(second.key)
  })
})

describe("l'adresse du visiteur", () => {
  const entetes = (values: Record<string, string>) => new Headers(values)

  it("préfère x-real-ip, que Traefik pose lui-même", () => {
    expect(clientIp(entetes({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7")
  })

  /**
   * Le test qui porte la décision de sécurité.
   *
   * Un proxy ajoute au BOUT de `x-forwarded-for` l'adresse qu'il a vue. Lire le
   * premier maillon — le réflexe le plus répandu — laisserait n'importe qui
   * choisir sa clé de comptage en envoyant l'en-tête lui-même, et le frein ne
   * freinerait plus personne.
   */
  it("retient le DERNIER maillon de x-forwarded-for, pas celui que le client annonce", () => {
    const menteur = entetes({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })

    expect(clientIp(menteur)).toBe("203.0.113.7")
  })

  it("se rabat sur x-forwarded-for quand x-real-ip manque", () => {
    expect(clientIp(entetes({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7")
  })

  it("rend une clé commune quand aucun proxy ne renseigne l'adresse", () => {
    expect(clientIp(entetes({}))).toBe("inconnue")
  })
})

describe("le message d'attente", () => {
  it("arrondit à la minute supérieure", () => {
    expect(tooManyAttemptsMessage(61_000)).toContain("2 minutes")
  })

  it("ne dit pas « 1 minutes »", () => {
    expect(tooManyAttemptsMessage(30_000)).toBe("Trop de tentatives. Réessayez dans une minute.")
  })

  it("ne nomme jamais le compte visé", () => {
    // Le message ne doit rien apprendre à qui essaie des adresses au hasard.
    expect(tooManyAttemptsMessage(600_000)).not.toMatch(/@/)
  })
})
