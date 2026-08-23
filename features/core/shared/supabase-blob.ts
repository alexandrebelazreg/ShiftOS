import type { SupabaseClient } from "@supabase/supabase-js"

import { requireStoreId } from "@/features/auth/supabase/current-store"

/**
 * Un seul bloc de configuration par magasin, lu et écrit d'un trait.
 *
 * Trois des réglages de ShiftOS ont cette forme : les écarts au tableau des
 * motifs d'absence, les décisions sur les jours fériés, et demain d'autres.
 * Ils se lisent TOUS ensemble à l'ouverture d'un écran, ne se cherchent jamais
 * par morceaux, et tiennent dans un objet. Les éclater en lignes obligerait à
 * les recoudre à chaque lecture sans rien rendre de plus interrogeable.
 *
 * Écrit par `upsert` sur la clé du magasin : il n'existe jamais qu'une ligne,
 * et distinguer « créer » de « mettre à jour » ne ferait qu'ajouter une lecture
 * préalable pour répondre à une question dont la réponse n'intéresse personne.
 */
export function createSupabaseBlobStore<T>(
  client: SupabaseClient,
  table: string,
  column: string,
  fallback: T
) {
  return {
    async read(): Promise<T> {
      const { data, error } = await client.from(table).select(column).maybeSingle()
      // Une erreur de lecture rend la valeur d'origine plutôt que de lever :
      // l'écran s'ouvre sur les réglages par défaut au lieu de refuser de
      // s'afficher, ce qui est le comportement qu'avait déjà `localStorage`
      // devant un stockage illisible.
      if (error || !data) return fallback
      // Passage par `unknown` : la colonne est nommée à l'exécution, donc
      // Supabase ne peut pas en déduire la forme et propose un type d'erreur.
      const value = (data as unknown as Record<string, unknown>)[column]
      return (value as T) ?? fallback
    },

    async save(value: T): Promise<void> {
      const storeId = await requireStoreId(client)
      const { error } = await client
        .from(table)
        .upsert({ store_id: storeId, [column]: value }, { onConflict: "store_id" })
      if (error) throw new Error(error.message)
    },

    async reset(): Promise<void> {
      const storeId = await requireStoreId(client)
      const { error } = await client.from(table).delete().eq("store_id", storeId)
      if (error) throw new Error(error.message)
    },
  }
}
