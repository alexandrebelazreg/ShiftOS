"use server"

import { createSupabaseServerClient } from "@/features/auth/supabase/server"
import { cookieStoreRepository } from "@/features/store/services/store.repository"
import { toStoreRow } from "@/features/store/services/store.supabase-repository"

/**
 * Le magasin, repris depuis le cookie.
 *
 * Les huit autres familles vivaient dans `localStorage`, que la page lit
 * elle-même. Celle-ci vit dans un cookie `httpOnly` — invisible au navigateur
 * par construction — donc seul le serveur peut la relever. D'où cette action,
 * plutôt qu'une ligne de plus dans l'écran de reprise.
 *
 * C'est l'entité qui manquait à la reprise, et son absence se voyait à l'usage :
 * le compte était partagé entre appareils, la configuration du magasin ne
 * l'était pas — d'où le renvoi vers « complétez votre magasin » à chaque
 * connexion depuis un autre poste.
 */
export async function importStoreFromCookie(): Promise<{ imported: boolean; reason?: string }> {
  const store = await cookieStoreRepository.getStore()
  if (!store) return { imported: false, reason: "aucun magasin dans ce navigateur" }

  const supabase = await createSupabaseServerClient()
  const { data: profile } = await supabase.from("profiles").select("store_id").maybeSingle()
  const storeId = profile?.store_id as string | undefined
  if (!storeId) return { imported: false, reason: "aucun magasin rattaché à ce compte" }

  const { error } = await supabase
    .from("stores")
    // Le parcours d'installation est marqué TERMINÉ du même geste, et ce n'est
    // pas une commodité : un magasin qu'on reprend est un magasin déjà
    // configuré — il a des secteurs, une équipe, des plannings passés. Sans
    // cette marque, la connexion suivante renverrait vers les six étapes de la
    // première installation, ce qui serait faux et surtout décourageant.
    .update({ ...toStoreRow(store), first_run_completed_at: new Date().toISOString() })
    .eq("id", storeId)
  if (error) return { imported: false, reason: error.message }

  return { imported: true }
}
