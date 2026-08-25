import type { MetadataRoute } from "next"

/**
 * Tout fermer. Il n'y a rien à indexer ici.
 *
 * Planiteo est un outil de magasin, pas un site : chacune de ses adresses
 * demande une session, et la seule page publique — `/confidentialite` — est
 * une note d'information destinée aux salariés du magasin, pas au web.
 *
 * Ce fichier DEMANDE, il n'empêche pas. Un robots.txt est une convention que
 * les moteurs sérieux respectent et que rien n'oblige. L'interdiction ferme
 * est l'en-tête `X-Robots-Tag: noindex, nofollow`, posé sur toutes les
 * réponses dans `next.config.ts`. Les deux se complètent : celui-ci évite
 * l'exploration, l'autre interdit l'indexation de ce qui serait trouvé
 * malgré tout.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  }
}
