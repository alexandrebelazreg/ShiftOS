/**
 * Le frein des tentatives de connexion.
 *
 * Ce qui manquait n'est pas évident, parce que Supabase limite déjà ses propres
 * points d'entrée. Mais la connexion de Planiteo passe par une server action :
 * c'est le SERVEUR qui appelle Supabase, jamais le navigateur. Toutes les
 * tentatives arrivent donc là-bas avec une seule et même adresse, celle du
 * conteneur. Le garde-fou par IP de Supabase ne distingue plus l'attaquant du
 * gérant qui se trompe de mot de passe, et le quota qu'il finit par épuiser est
 * commun aux deux. Compter ici est la seule façon de compter juste.
 *
 * Une fenêtre glissante plutôt qu'un verrou : au bout de quinze minutes, un
 * échec cesse simplement d'être compté. Aucun compte ne reste bloqué, et
 * personne n'a de bouton à presser pour rouvrir.
 *
 * Le revers, assumé : qui connaît l'adresse d'un gérant peut la mettre en
 * attente en se trompant cinq fois. C'est le défaut de tout comptage par
 * compte, et la parade est la brièveté de la fenêtre — quinze minutes gênent,
 * un verrou définitif se retourne en déni de service.
 *
 * L'état vit en mémoire, dans le processus. C'est suffisant pour un conteneur
 * unique, qui est le déploiement d'aujourd'hui, et cela veut dire deux choses
 * qu'il faut savoir : un redémarrage remet tous les compteurs à zéro, et le
 * jour où deux instances serviront le même magasin, chacune comptera dans son
 * coin. Ce jour-là, ce fichier devra écrire ailleurs — la forme des méthodes
 * est faite pour que seul leur intérieur change.
 */

/** Une limite : une clé de comptage, et le nombre d'échecs qu'elle tolère. */
export interface AttemptLimit {
  readonly key: string
  readonly max: number
}

/** La fenêtre glissante. Passé ce délai, un échec ne compte plus. */
export const WINDOW_MS = 15 * 60_000

/** Ce qu'une adresse tolère avant d'être mise en attente. */
export const MAX_PER_EMAIL = 5

/**
 * Ce qu'une adresse IP tolère, tous comptes confondus.
 *
 * Plus haut que la limite par compte, et c'est voulu : les deux ne visent pas
 * la même attaque. Cinq par compte arrête qui s'acharne sur un gérant ; vingt
 * par IP arrête qui essaie un même mot de passe sur toute une liste d'adresses,
 * en restant sous la limite de chacune. Un magasin entier derrière une seule
 * connexion internet reste très loin de vingt échecs en un quart d'heure.
 */
export const MAX_PER_IP = 20

/** Au-delà, la table est balayée de ses entrées périmées. */
const MAX_TRACKED_KEYS = 10_000

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>()

  /**
   * Le temps qu'il reste à attendre, en millisecondes. Zéro quand la tentative
   * est permise.
   *
   * Rend le plus long des délais quand plusieurs limites sont atteintes : être
   * libéré par l'une pendant que l'autre retient n'aurait aucun sens.
   */
  retryAfterMs(limits: readonly AttemptLimit[], now: number): number {
    let wait = 0
    for (const limit of limits) {
      const recent = this.recent(limit.key, now)
      if (recent.length < limit.max) continue

      // Il faut que `recent.length - max + 1` échecs sortent de la fenêtre pour
      // repasser sous le plafond. Celui qui libère est donc à l'index
      // `recent.length - max`, et la liste est triée par construction.
      const releasing = recent[recent.length - limit.max]
      wait = Math.max(wait, releasing + WINDOW_MS - now)
    }
    return wait
  }

  /** Enregistre un échec sur chacune des clés. */
  recordFailure(limits: readonly AttemptLimit[], now: number): void {
    for (const limit of limits) {
      const recent = this.recent(limit.key, now)
      recent.push(now)
      this.failures.set(limit.key, recent)
    }
    if (this.failures.size > MAX_TRACKED_KEYS) this.sweep(now)
  }

  /**
   * Efface le passé de ces clés.
   *
   * Appelé après une connexion RÉUSSIE : quatre erreurs de frappe suivies du
   * bon mot de passe ne doivent pas laisser le gérant à une tentative de
   * l'attente. Ce qui est prouvé, c'est qu'il connaît son mot de passe.
   */
  forget(limits: readonly AttemptLimit[]): void {
    for (const limit of limits) this.failures.delete(limit.key)
  }

  /** Tout oublier. */
  clear(): void {
    this.failures.clear()
  }

  /** Les échecs encore dans la fenêtre, du plus ancien au plus récent. */
  private recent(key: string, now: number): number[] {
    return (this.failures.get(key) ?? []).filter((at) => at > now - WINDOW_MS)
  }

  private sweep(now: number): void {
    for (const [key, times] of this.failures) {
      if (times.every((at) => at <= now - WINDOW_MS)) this.failures.delete(key)
    }
  }
}

/** L'instance que partagent toutes les requêtes du processus. */
export const loginThrottle = new LoginThrottle()

/**
 * Les deux clés d'une tentative.
 *
 * L'adresse est ramenée en minuscules : `Alex@magasin.fr` et
 * `alex@magasin.fr` désignent le même compte, et deux compteurs distincts
 * offriraient le double d'essais à qui alterne la casse.
 */
export function loginLimits(email: string, ip: string): readonly AttemptLimit[] {
  return [
    { key: `email:${email.toLowerCase()}`, max: MAX_PER_EMAIL },
    { key: `ip:${ip}`, max: MAX_PER_IP },
  ]
}

/**
 * L'adresse du visiteur, telle que le reverse proxy la rapporte.
 *
 * Traefik pose `x-real-ip`, et c'est la source la plus simple. À défaut, le
 * DERNIER maillon de `x-forwarded-for` : un proxy ajoute au BOUT de la liste
 * l'adresse qu'il a réellement vue, donc un client qui poserait lui-même un
 * `x-forwarded-for` menteur n'en allonge que le début. Lire le premier maillon,
 * réflexe courant, rendrait le comptage contournable en une ligne d'en-tête.
 *
 * Sans aucun des deux — en local, sans proxy devant — tout le monde partage la
 * même clé. C'est le comportement voulu : une seule machine, un seul compteur.
 */
export function clientIp(headers: { get(name: string): string | null }): string {
  const real = headers.get("x-real-ip")?.trim()
  if (real) return real

  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean)

  return hops.at(-1) ?? "inconnue"
}

/** Ce que voit celui qui a trop essayé. */
export function tooManyAttemptsMessage(waitMs: number): string {
  const minutes = Math.ceil(waitMs / 60_000)
  return minutes <= 1
    ? "Trop de tentatives. Réessayez dans une minute."
    : `Trop de tentatives. Réessayez dans ${minutes} minutes.`
}
