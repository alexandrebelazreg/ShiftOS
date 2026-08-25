import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { supabaseConfigured, supabaseKey, supabaseUrl } from "@/features/auth/supabase/config"

/**
 * `proxy.ts`, et non `middleware.ts`.
 *
 * Next 16 a renommé la convention. Un `middleware.ts` serait silencieusement
 * ignoré — pas d'erreur, pas d'avertissement, juste une session qui ne tient
 * pas. C'est le piège de tous les guides Supabase écrits avant cette version.
 *
 * Ce fichier fait DEUX choses, et rien de plus.
 *
 * 1. Il reconduit la session. Un Server Component ne peut pas écrire de cookie ;
 *    sans ce passage, le jeton expirerait sans jamais être renouvelé et
 *    l'utilisateur serait déconnecté au hasard.
 *
 * 2. Il redirige de façon OPTIMISTE. Next 16 est explicite : le proxy « n'est
 *    pas destiné à la gestion de session ni à l'autorisation », et ne doit lire
 *    que le cookie, jamais la base. Il tourne aussi sur les routes préchargées,
 *    donc une vérification en base y serait coûteuse — et contournable.
 *
 * L'autorisation réelle vit dans `features/auth/dal.ts`, traversée par chaque
 * page, action et route. Ce fichier n'est qu'un filtre de confort.
 *
 * Il porte AUSSI la politique de sécurité du contenu, pour une raison qui n'a
 * rien à voir avec l'authentification : le nonce doit changer à chaque requête,
 * donc il ne peut pas vivre dans `next.config.ts`, qui ne connaît que des
 * valeurs constantes. Les en-têtes constants sont là-bas ; celui-ci est ici.
 */

/**
 * La politique, reconstruite à chaque requête parce que son nonce l'est.
 *
 * `strict-dynamic` fait ignorer `'self'` par les navigateurs qui le
 * comprennent : seuls les scripts portant le nonce s'exécutent, et ceux qu'ils
 * chargent à leur tour. Next pose ce nonce lui-même sur ses scripts de
 * framework, ses bundles de page et ses styles en ligne, à condition de lire
 * l'en-tête sur la REQUÊTE — d'où la double pose plus bas.
 */
function contentSecurityPolicy(nonce: string, request: NextRequest): string {
  const dev = process.env.NODE_ENV === "development"

  /**
   * La connexion est-elle RÉELLEMENT chiffrée ?
   *
   * Deux sources, parce qu'aucune ne suffit : derrière Traefik, le dernier
   * bond jusqu'à Next se fait en clair, donc `nextUrl.protocol` dit « http »
   * sur un site pourtant servi en HTTPS. C'est `x-forwarded-proto` qui porte
   * la vérité, et l'inverse est vrai en local, où aucun proxy ne le pose.
   */
  const secure =
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"

  // Les dépôts d'absences, de salariés et de congés parlent à Supabase DEPUIS
  // le navigateur. Sans cette origine, `connect-src 'self'` couperait chacune
  // de leurs lectures — et l'écran resterait vide sans dire pourquoi.
  const supabase = supabaseConfigured() ? new URL(supabaseUrl()).origin : null

  return [
    "default-src 'self'",
    // `unsafe-eval` en développement seulement : React s'en sert pour
    // reconstruire les piles d'erreur serveur dans le navigateur. En
    // production, ni React ni Next n'évaluent de chaîne.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    // Les polices sont servies depuis ce domaine : `next/font/google` les
    // télécharge à la compilation. Aucune origine tierce à ouvrir ici, et
    // c'est ce qui garde les adresses IP des salariés hors de chez Google.
    "font-src 'self'",
    supabase ? `connect-src 'self' ${supabase}` : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    /**
     * Posée seulement quand la page arrive déjà par HTTPS.
     *
     * Sur une origine en clair, cette directive promeut jusqu'aux cibles de
     * redirection : le 307 vers `/login` part en `https://` sur un serveur qui
     * n'écoute qu'en HTTP, et la connexion échoue sur une erreur TLS que rien
     * ne relie à une politique de sécurité. Or `DEPLOY.md` autorise
     * explicitement un premier essai sur `http://<IP>:3000`, et `next start`
     * en local est dans le même cas.
     *
     * Ce qui force HTTPS, c'est HSTS, posé dans `next.config.ts`. Celle-ci n'y
     * ajoute que la protection du contenu mixte — et il n'y en a aucun ici :
     * aucune ressource tierce, aucune adresse `http://` écrite en dur.
     */
    ...(secure ? ["upgrade-insecure-requests"] : []),
  ].join("; ")
}

export async function proxy(request: NextRequest) {
  // 16 octets, encodés en base64 : imprévisible, et régénéré à chaque requête.
  // Un nonce deviné est un nonce inutile.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
  const csp = contentSecurityPolicy(nonce, request)

  /**
   * Les en-têtes transmis au rendu, relus à CHAQUE appel.
   *
   * Relus, et non capturés une fois : `setAll` écrit les cookies rafraîchis
   * dans `request.cookies` juste avant de construire la réponse, ce qui modifie
   * l'en-tête `cookie` de la requête. Un instantané pris au début du proxy
   * porterait l'ancienne session, et le jeton reconduit se perdrait en route.
   */
  const forwarded = () => {
    const headers = new Headers(request.headers)
    headers.set("x-nonce", nonce)
    headers.set("content-security-policy", csp)
    return headers
  }

  /** La même politique sur la réponse : la requête sert au rendu, celle-ci au navigateur. */
  const withCsp = (response: NextResponse) => {
    response.headers.set("content-security-policy", csp)
    return response
  }

  // Tant que la base n'est pas configurée, l'application doit continuer de
  // servir ses pages. Un proxy qui lève ici rendrait le site entier
  // inaccessible sur un simple oubli de variable d'environnement.
  if (!supabaseConfigured()) {
    return withCsp(NextResponse.next({ request: { headers: forwarded() } }))
  }

  let response = NextResponse.next({ request: { headers: forwarded() } })

  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request: { headers: forwarded() } })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // L'appel qui reconduit le jeton. Son résultat sert aussi à la redirection
  // optimiste ci-dessous — mais il ne remplace pas la vérification du DAL.
  const { data } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  // `/confidentialite` est publique pour la même raison que `/login` : les
  // salariés dont les données sont enregistrées n'ont PAS de compte, et
  // n'en auront pas. Une information sur le traitement qu'il faudrait se
  // connecter pour lire n'est pas une information donnée.
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/confidentialite")

  // Les routes d'API traversent le proxy pour que leur session soit reconduite,
  // mais ne sont JAMAIS redirigées. Une redirection n'est pas une réponse qu'un
  // appelant d'API sait lire : il la suivrait et recevrait la page de connexion
  // en HTML là où il attend un verdict. Elles refusent elles-mêmes, en JSON et
  // avec un 401 — ce qui est aussi la conduite que Next 16 recommande, puisque
  // l'autorisation ne doit pas dépendre de ce fichier.
  const isApi = path.startsWith("/api/")

  if (!data.user && !isPublic && !isApi) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    // D'où l'on venait, pour y revenir après la connexion.
    url.searchParams.set("suivant", path)
    return NextResponse.redirect(url)
  }

  if (data.user && path.startsWith("/login")) {
    const url = request.nextUrl.clone()
    url.pathname = "/dashboard"
    url.search = ""
    return NextResponse.redirect(url)
  }

  // Les deux redirections ci-dessus ne reçoivent PAS la politique : une réponse
  // 307 n'a pas de corps, donc rien à y protéger. C'est la page d'arrivée qui
  // repassera par ce fichier et recevra la sienne, avec son propre nonce.
  return withCsp(response)
}

export const config = {
  // Tout, sauf ce qui n'a pas de session à porter : fichiers statiques, images
  // optimisées, favicon. Les faire traverser le proxy coûterait un appel
  // d'authentification par icône.
  //
  // `robots.txt` est dans cette liste pour une raison plus sévère qu'un coût.
  // Sans l'exclure, il traverse le proxy, n'est ni public ni une route d'API,
  // et part donc en redirection vers `/login` : le robot reçoit une page de
  // connexion au lieu du fichier, et l'interdiction d'explorer n'est jamais
  // lue. Un fichier destiné à des visiteurs anonymes ne peut pas vivre
  // derrière le garde qui les refuse.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
