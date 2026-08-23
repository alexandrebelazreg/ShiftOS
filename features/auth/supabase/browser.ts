"use client"

import { createBrowserClient } from "@supabase/ssr"

import { supabaseKey, supabaseUrl } from "@/features/auth/supabase/config"

/**
 * Le client Supabase du navigateur.
 *
 * Réservé à ce qui doit vivre dans la page : l'écoute des changements de
 * session, et la déconnexion. Toute LECTURE de données passe par le serveur —
 * c'est là que la session est vérifiée et que le `store_id` est scellé.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(supabaseUrl(), supabaseKey())
}
