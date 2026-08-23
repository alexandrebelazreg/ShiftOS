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
 */
export async function proxy(request: NextRequest) {
  // Tant que la base n'est pas configurée, l'application doit continuer de
  // servir ses pages. Un proxy qui lève ici rendrait le site entier
  // inaccessible sur un simple oubli de variable d'environnement.
  if (!supabaseConfigured()) return NextResponse.next({ request })

  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
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
  const isPublic = path.startsWith("/login") || path.startsWith("/auth")

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

  return response
}

export const config = {
  // Tout, sauf ce qui n'a pas de session à porter : fichiers statiques, images
  // optimisées, favicon. Les faire traverser le proxy coûterait un appel
  // d'authentification par icône.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
