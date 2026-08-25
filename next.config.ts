import type { NextConfig } from "next"

/**
 * Les en-têtes qui ne dépendent pas de la requête.
 *
 * Ceux qui en dépendent — la CSP et son nonce, recalculés à chaque rendu —
 * vivent dans `proxy.ts`. La séparation n'est pas esthétique : une valeur
 * constante posée ici est servie par le serveur statique de Next AUSSI pour
 * les fichiers de `public/` et les assets, que le proxy ne voit jamais.
 */
const securityHeaders = [
  /**
   * Aucun moteur ne doit indexer cet outil.
   *
   * `robots.ts` le demande poliment, mais un `robots.txt` n'empêche pas
   * l'indexation : il décourage l'exploration. Une adresse trouvée ailleurs —
   * un lien collé dans un message, un certificat TLS publié dans les journaux
   * de transparence — s'indexe malgré lui. Cet en-tête, lui, interdit.
   */
  { key: "X-Robots-Tag", value: "noindex, nofollow" },

  /**
   * Un an, sous-domaines compris.
   *
   * `DEPLOY.md` note qu'en HTTP le cookie de session voyage en clair. Cet
   * en-tête fait que le navigateur refuse de repasser en HTTP, y compris sur
   * une première frappe d'adresse après la première visite. Sans `preload` :
   * la liste de préchargement est difficile à quitter, et ce domaine est trop
   * jeune pour un engagement qu'on ne défait pas.
   */
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },

  /** Le navigateur cesse de deviner le type d'un fichier servi. */
  { key: "X-Content-Type-Options", value: "nosniff" },

  /**
   * Doublon assumé de `frame-ancestors 'none'` dans la CSP.
   *
   * La CSP est posée par le proxy, qui ne voit pas tout ; celui-ci couvre
   * aussi ce qui sort du serveur statique, et les navigateurs anciens qui
   * ignorent `frame-ancestors`.
   */
  { key: "X-Frame-Options", value: "DENY" },

  /**
   * L'origine seule quand on sort du site, l'adresse complète en interne.
   *
   * Les adresses de Planiteo portent des identifiants de salarié et de
   * semaine. Elles n'ont rien à faire dans les journaux d'un site tiers.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  /**
   * Rien de tout cela n'est utilisé, et un outil de planning n'a aucune raison
   * de le demander un jour. Le refus est explicite pour qu'une dépendance ne
   * puisse pas le demander à sa place.
   */
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
]

const nextConfig: NextConfig = {
  // `X-Powered-By: Next.js` annonce le framework et sa famille de failles à qui
  // scanne. Il ne sert à rien d'autre.
  poweredByHeader: false,

  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }])
  },
}

export default nextConfig
