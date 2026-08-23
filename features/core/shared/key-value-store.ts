/**
 * Le peu de `Storage` dont un dépôt a besoin, et de quoi s'en passer.
 *
 * Les dépôts de Planiteo reçoivent leur stockage plutôt que d'aller le chercher.
 * C'est ce qui les rend testables sans navigateur — et c'est la couture par
 * laquelle Postgres remplacera `localStorage` sans qu'un seul appelant change.
 *
 * Le type ne demande que trois méthodes : un dépôt qui exigerait `Storage`
 * entier obligerait chaque double de test à inventer `length`, `key` et
 * `clear`, dont il ne fait rien.
 */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">

/**
 * Un stockage qui n'oublie jamais rien parce qu'il ne retient rien.
 *
 * Rendu quand il n'y a pas de fenêtre — au rendu serveur, dans un test. Écrire
 * dedans ne lève pas : un écran rendu côté serveur doit pouvoir traverser son
 * code de chargement sans exploser, et il n'a de toute façon rien à persister.
 */
export function nullStore(): KeyValueStore {
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
}

/** Un stockage en mémoire, pour les tests qui veulent vérifier ce qui a été écrit. */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

/**
 * Le stockage du navigateur, ou l'oubli quand il n'y en a pas.
 *
 * Résolu à CHAQUE appel, jamais mémorisé au chargement du module : un double
 * installé par un test après l'import doit être vu, et un module chargé pendant
 * un rendu serveur puis réutilisé côté client ne doit pas rester coincé sur le
 * stockage vide qu'il avait trouvé la première fois.
 */
export function browserStore(): KeyValueStore {
  if (typeof window === "undefined") return nullStore()
  return window.localStorage
}
