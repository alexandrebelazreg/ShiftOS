import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { supabaseKey, supabaseUrl } from "@/features/auth/supabase/config"

/**
 * Le client Supabase côté serveur, lié aux cookies de la requête en cours.
 *
 * `getAll` / `setAll` et rien d'autre. Les méthodes `get` / `set` / `remove`
 * individuelles existent encore dans d'anciens guides et cassent l'application :
 * la session Supabase tient sur plusieurs cookies qui doivent être écrits
 * ensemble, et les poser un par un produit un état à moitié authentifié qui ne
 * lève aucune erreur — il déconnecte simplement l'utilisateur au hasard.
 *
 * `server-only` en tête : ce module lit les cookies de la requête, et un import
 * depuis un composant client doit échouer à la compilation plutôt que fuiter
 * une session dans un bundle navigateur.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Un Server Component ne peut pas écrire de cookie : Next l'interdit
          // hors action et hors route handler. L'ignorer est LA conduite
          // correcte, à une condition — que le proxy rafraîchisse la session à
          // chaque requête, ce qu'il fait. Sans lui, ce catch avalerait la
          // reconduction du jeton et l'utilisateur serait déconnecté à
          // l'expiration, sans trace.
        }
      },
    },
  })
}
